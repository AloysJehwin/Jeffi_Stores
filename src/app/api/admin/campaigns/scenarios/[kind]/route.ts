import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query } from '@/lib/db'
import { getScenario } from '@/lib/campaigns/scenarios/_registry'

export const dynamic = 'force-dynamic'

interface CampaignDetailRow {
  kind: string
  name: string
  description: string | null
  enabled: boolean
  delay_hours: number
  discount_percent: number
  parameters: Record<string, unknown> | null
  last_run_at: string | null
  total_sent: string
  total_opened: string
  total_clicked: string
  total_converted: string
}

interface CustomScenarioRow {
  kind: string
  name: string
  description: string | null
  ai_prompt: string
  generated_sql: string
  enabled: boolean
  dry_run_count: number | null
  parameters: Record<string, unknown> | null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let scenarioPayload: any = null

  const UNIVERSAL_DEFAULTS = {
    sendCooldownDays: 1,
    maxRecipientsPerSweep: 50,
  }
  const UNIVERSAL_SCHEMA = {
    sendCooldownDays:      { type: 'integer', min: 1, max: 30,  label: 'Per-user cooldown (days)', description: 'Skip users sent this campaign within N days' },
    maxRecipientsPerSweep: { type: 'integer', min: 1, max: 500, label: 'Max recipients per run',   description: 'Hard limit per sweep' },
  }

  const builtin = getScenario(kind)
  if (builtin) {
    scenarioPayload = {
      kind: builtin.kind,
      name: builtin.name,
      description: builtin.description,
      trigger: builtin.trigger,
      type: 'builtin',
      enabled: true,
      default_parameters: { ...UNIVERSAL_DEFAULTS, ...builtin.defaultParams },
      param_schema: { ...UNIVERSAL_SCHEMA, ...builtin.paramSchema },
    }
  } else {
    const custom = await queryOne<CustomScenarioRow>(
      `SELECT kind, name, description, ai_prompt, generated_sql, enabled, dry_run_count, parameters
       FROM custom_scenarios WHERE kind = $1`,
      [kind]
    )
    if (!custom) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })
    scenarioPayload = {
      kind: custom.kind,
      name: custom.name,
      description: custom.description || '',
      trigger: custom.ai_prompt,
      type: 'custom',
      enabled: custom.enabled,
      generated_sql: custom.generated_sql,
      dry_run_count: custom.dry_run_count,
      default_parameters: {
        ...UNIVERSAL_DEFAULTS,
        ...(custom.parameters || {}),
      },
      param_schema: UNIVERSAL_SCHEMA,
    }
  }

  const campaigns = await queryMany<CampaignDetailRow>(`
    SELECT
      c.kind, c.name, c.description, c.enabled, c.delay_hours, c.discount_percent,
      c.parameters, c.last_run_at,
      COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind), 0)::text AS total_sent,
      COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.opened_at IS NOT NULL), 0)::text AS total_opened,
      COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.clicked_at IS NOT NULL), 0)::text AS total_clicked,
      COALESCE((SELECT COUNT(*) FROM email_campaigns_sent ecs WHERE ecs.campaign_kind = c.kind AND ecs.converted_at IS NOT NULL), 0)::text AS total_converted
    FROM campaigns c
    WHERE c.scenario_kind = $1
    ORDER BY c.name
  `, [kind])

  return NextResponse.json({
    scenario: scenarioPayload,
    campaigns: campaigns.map(c => ({
      ...c,
      total_sent: parseInt(c.total_sent, 10),
      total_opened: parseInt(c.total_opened, 10),
      total_clicked: parseInt(c.total_clicked, 10),
      total_converted: parseInt(c.total_converted, 10),
    })),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  if (getScenario(kind)) {
    return NextResponse.json({ error: 'Built-in scenarios cannot be modified' }, { status: 400 })
  }

  const exists = await queryOne(`SELECT kind FROM custom_scenarios WHERE kind = $1`, [kind])
  if (!exists) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const updates: string[] = ['updated_at = NOW()']
  const vals: any[] = []
  let i = 1

  if (typeof body.enabled === 'boolean') {
    updates.push(`enabled = $${i++}`)
    vals.push(body.enabled)
  }
  if (typeof body.name === 'string' && body.name.trim()) {
    updates.push(`name = $${i++}`)
    vals.push(body.name.trim().slice(0, 128))
  }
  if (typeof body.description === 'string') {
    updates.push(`description = $${i++}`)
    vals.push(body.description.trim() || null)
  }

  vals.push(kind)
  await query(`UPDATE custom_scenarios SET ${updates.join(', ')} WHERE kind = $${i}`, vals)

  await query(
    `INSERT INTO scenario_audit_log (admin_id, scenario_kind, action, result) VALUES ($1, $2, 'patch', $3::jsonb)`,
    [admin.id, kind, JSON.stringify(body)]
  ).catch(() => {})

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  if (getScenario(kind)) {
    return NextResponse.json({ error: 'Built-in scenarios cannot be deleted' }, { status: 400 })
  }

  const exists = await queryOne(`SELECT kind FROM custom_scenarios WHERE kind = $1`, [kind])
  if (!exists) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })

  const linkedCampaigns = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM campaigns WHERE scenario_kind = $1`,
    [kind]
  )
  if (parseInt(linkedCampaigns?.count || '0', 10) > 0) {
    return NextResponse.json({ error: 'Cannot delete — campaigns still use this scenario. Delete or reassign them first.' }, { status: 400 })
  }

  await query(`DELETE FROM scenarios WHERE kind = $1`, [kind])

  await query(
    `INSERT INTO scenario_audit_log (admin_id, scenario_kind, action) VALUES ($1, $2, 'delete')`,
    [admin.id, kind]
  ).catch(() => {})

  return NextResponse.json({ success: true })
}
