import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getCampaign } from '@/lib/marketing'
import { getScenario } from '@/lib/campaigns/scenarios/_registry'
import { resolveParams } from '@/lib/campaigns/types'
import { queryMany, queryOne, getClient } from '@/lib/db'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'

export const dynamic = 'force-dynamic'

const PREVIEW_STATEMENT_TIMEOUT_MS = 5000
const PREVIEW_LIMIT = 200
const PREVIEW_COOLDOWN_DAYS = 0

interface EligibleRecipient {
  reference_id: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  marketing_opt_out: boolean
  raw: Record<string, unknown>
}

export async function GET(req: NextRequest, { params }: { params: { kind: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const campaign = await getCampaign(params.kind as any)
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const scenarioKind = (campaign as any).scenario_kind || params.kind

  const builtin = getScenario(scenarioKind)
  if (builtin) {
    return runBuiltin(builtin, campaign, scenarioKind)
  }

  const custom = await queryOne<{ kind: string; generated_sql: string; product_sql: string | null; enabled: boolean; description: string | null; ai_prompt: string | null }>(
    `SELECT kind, generated_sql, product_sql, enabled, description, ai_prompt FROM custom_scenarios WHERE kind = $1`,
    [scenarioKind]
  )
  if (custom) {
    return runCustom(custom, campaign, scenarioKind)
  }

  return NextResponse.json({ eligible: [], total: 0, scenarioKind, note: 'No automation scenario module registered for this campaign — eligibility cannot be computed.' })
}

async function runBuiltin(scenario: any, campaign: any, scenarioKind: string) {
  const resolvedParams = resolveParams(scenario.defaultParams, campaign.parameters)

  let rows: any[] = []
  try {
    rows = await scenario.findEligible({ campaign, params: resolvedParams })
  } catch (err: any) {
    return NextResponse.json({ eligible: [], total: 0, error: err?.message || 'findEligible failed' }, { status: 500 })
  }

  let suppressed: any[] = []
  if (typeof scenario.findSuppressed === 'function') {
    try {
      suppressed = await scenario.findSuppressed({ campaign, params: resolvedParams })
    } catch {
      suppressed = []
    }
  }

  const allUserIds = Array.from(new Set([...rows, ...suppressed].map(r => r.user_id || r.id).filter(Boolean)))
  const users = allUserIds.length > 0
    ? await queryMany<{ id: string; email: string; first_name: string | null; last_name: string | null; marketing_opt_out: boolean }>(
        `SELECT id::text, email, first_name, last_name, marketing_opt_out FROM users WHERE id = ANY($1::uuid[])`,
        [allUserIds]
      )
    : []
  const userMap = new Map(users.map(u => [u.id, u]))

  if (rows.length === 0 && suppressed.length === 0) {
    return NextResponse.json({ eligible: [], total: 0, suppressed: [], scenarioKind, params: resolvedParams, trigger: scenario.trigger, description: scenario.description, paramSchema: scenario.paramSchema })
  }

  const eligible: EligibleRecipient[] = rows.map((r, idx) => {
    const userId = r.user_id ?? r.id ?? null
    const u = userId ? userMap.get(userId) : null
    const refId = r.id || (r.user_id && r.product_id ? `${r.user_id}:${r.product_id}` : `${userId || 'row'}-${idx}`)
    return {
      reference_id: String(refId),
      user_id: userId,
      user_email: u?.email ?? null,
      user_name: u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() || null : null,
      marketing_opt_out: u?.marketing_opt_out ?? false,
      raw: { ...r, user_id: undefined },
    }
  })

  const suppressedOut = suppressed.map((s, idx) => {
    const userId = s.user_id ?? s.id ?? null
    const u = userId ? userMap.get(userId) : null
    const refId = s.reference_id || userId || `sup-${idx}`
    return {
      reference_id: String(refId),
      user_id: userId,
      user_email: u?.email ?? null,
      user_name: u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() || null : null,
      reason: s.reason,
      reason_detail: s.reason_detail ?? null,
      blocked_until: s.blocked_until ?? null,
      raw: s.raw || {},
    }
  })

  return NextResponse.json({
    eligible,
    total: eligible.length,
    suppressed: suppressedOut,
    suppressedTotal: suppressedOut.length,
    scenarioKind,
    params: resolvedParams,
    trigger: scenario.trigger,
    description: scenario.description,
    paramSchema: scenario.paramSchema,
  })
}

async function runCustom(
  custom: { kind: string; generated_sql: string; product_sql: string | null; enabled: boolean; description: string | null; ai_prompt: string | null },
  campaign: any,
  scenarioKind: string
) {
  const validation = validateScenarioSql(custom.generated_sql, 'audience')
  if (!validation.ok) {
    return NextResponse.json({ eligible: [], total: 0, scenarioKind, error: `Saved SQL failed safety check: ${validation.reason}` })
  }

  const params = (campaign as any).parameters || {}
  const cooldownDays = typeof params.sendCooldownDays === 'number' ? params.sendCooldownDays : PREVIEW_COOLDOWN_DAYS

  let userIds: string[] = []
  let elapsedMs = 0
  const start = Date.now()
  const client = await getClient()
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = '${PREVIEW_STATEMENT_TIMEOUT_MS}ms'`)
    await client.query(`SET LOCAL lock_timeout = '1s'`)
    const r = await client.query<{ id: string }>(validation.normalized, [campaign.kind, cooldownDays, PREVIEW_LIMIT])
    userIds = r.rows.map(x => x.id)
    await client.query('ROLLBACK')
  } catch (err: any) {
    try { await client.query('ROLLBACK') } catch {}
    return NextResponse.json({ eligible: [], total: 0, scenarioKind, error: err?.message || 'Preview query failed' }, { status: 500 })
  } finally {
    elapsedMs = Date.now() - start
    client.release()
  }

  const users = userIds.length > 0
    ? await queryMany<{ id: string; email: string; first_name: string | null; last_name: string | null; marketing_opt_out: boolean }>(
        `SELECT id::text, email, first_name, last_name, marketing_opt_out FROM users WHERE id = ANY($1::uuid[])`,
        [userIds]
      )
    : []
  const userMap = new Map(users.map(u => [u.id, u]))

  const eligible: EligibleRecipient[] = userIds.map((uid, idx) => {
    const u = userMap.get(uid)
    return {
      reference_id: `${uid}-${idx}`,
      user_id: uid,
      user_email: u?.email ?? null,
      user_name: u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() || null : null,
      marketing_opt_out: u?.marketing_opt_out ?? false,
      raw: {},
    }
  })

  return NextResponse.json({
    eligible,
    total: eligible.length,
    suppressed: [],
    suppressedTotal: 0,
    scenarioKind,
    params,
    trigger: custom.ai_prompt || 'Custom AI-generated audience query',
    description: custom.description || 'Custom scenario',
    paramSchema: {},
    isCustom: true,
    elapsedMs,
    note: custom.enabled ? null : 'This custom scenario is currently DISABLED — preview only.',
  })
}
