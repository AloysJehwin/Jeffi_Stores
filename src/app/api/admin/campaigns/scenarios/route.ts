import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import { listScenarios, getScenario } from '@/lib/campaigns/scenarios/_registry'

export const dynamic = 'force-dynamic'

interface AggregateRow {
  scenario_kind: string
  campaigns_count: string
  total_sent: string
  total_opened: string
  total_clicked: string
  total_converted: string
  last_run_at: string | null
}

interface CampaignRow {
  scenario_kind: string
  kind: string
  name: string
  enabled: boolean
  delay_hours: number
  discount_percent: number
  last_run_at: string | null
}

interface CustomScenarioRow {
  kind: string
  name: string
  description: string | null
  ai_prompt: string
  enabled: boolean
  dry_run_count: number | null
  parameters: Record<string, unknown> | null
  approved_at: string | null
}

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const aggregates = await queryMany<AggregateRow>(`
    SELECT
      c.scenario_kind,
      COUNT(DISTINCT c.kind)::text AS campaigns_count,
      COALESCE(SUM(stats.total_sent), 0)::text AS total_sent,
      COALESCE(SUM(stats.total_opened), 0)::text AS total_opened,
      COALESCE(SUM(stats.total_clicked), 0)::text AS total_clicked,
      COALESCE(SUM(stats.total_converted), 0)::text AS total_converted,
      MAX(c.last_run_at) AS last_run_at
    FROM campaigns c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS total_sent,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS total_opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS total_clicked,
        COUNT(*) FILTER (WHERE converted_at IS NOT NULL) AS total_converted
      FROM email_campaigns_sent
      WHERE campaign_kind = c.kind
    ) stats ON TRUE
    WHERE c.scenario_kind IS NOT NULL
    GROUP BY c.scenario_kind
  `)

  const campaignRows = await queryMany<CampaignRow>(`
    SELECT scenario_kind, kind, name, enabled, delay_hours, discount_percent, last_run_at
    FROM campaigns
    WHERE scenario_kind IS NOT NULL
    ORDER BY name
  `)

  const aggMap = new Map(aggregates.map(a => [a.scenario_kind, a]))
  const campaignsByScenario = new Map<string, CampaignRow[]>()
  for (const c of campaignRows) {
    const arr = campaignsByScenario.get(c.scenario_kind) || []
    arr.push(c)
    campaignsByScenario.set(c.scenario_kind, arr)
  }

  const UNIVERSAL_DEFAULTS: Record<string, number | boolean | string> = {
    sendCooldownDays: 1,
    maxRecipientsPerSweep: 50,
  }
  const UNIVERSAL_SCHEMA: Record<string, { type: string; min?: number; max?: number; label: string; description?: string }> = {
    sendCooldownDays:      { type: 'integer', min: 1, max: 30,  label: 'Per-user cooldown (days)', description: 'Skip users sent this campaign within N days' },
    maxRecipientsPerSweep: { type: 'integer', min: 1, max: 500, label: 'Max recipients per run',   description: 'Hard limit per sweep' },
  }

  const scenarios = listScenarios().map(s => {
    const agg = aggMap.get(s.kind)
    return {
      kind: s.kind,
      name: s.name,
      description: s.description,
      trigger: s.trigger,
      type: 'builtin' as const,
      enabled: true,
      default_parameters: { ...UNIVERSAL_DEFAULTS, ...s.defaultParams },
      param_schema: { ...UNIVERSAL_SCHEMA, ...s.paramSchema },
      stats: {
        campaigns_count: agg ? parseInt(agg.campaigns_count, 10) : 0,
        total_sent: agg ? parseInt(agg.total_sent, 10) : 0,
        total_opened: agg ? parseInt(agg.total_opened, 10) : 0,
        total_clicked: agg ? parseInt(agg.total_clicked, 10) : 0,
        total_converted: agg ? parseInt(agg.total_converted, 10) : 0,
        last_run_at: agg?.last_run_at || null,
      },
      campaigns: campaignsByScenario.get(s.kind) || [],
    }
  })

  const customRows = await queryMany<CustomScenarioRow>(`
    SELECT kind, name, description, ai_prompt, enabled, dry_run_count, parameters, approved_at
    FROM custom_scenarios
    ORDER BY created_at DESC
  `)

  for (const c of customRows) {
    if (getScenario(c.kind)) continue
    const agg = aggMap.get(c.kind)
    const customDefaults: Record<string, number | boolean | string> = {
      ...UNIVERSAL_DEFAULTS,
      ...((c.parameters || {}) as Record<string, number | boolean | string>),
    }
    scenarios.push({
      kind: c.kind,
      name: c.name,
      description: c.description || '',
      trigger: c.ai_prompt,
      type: 'custom' as const,
      enabled: c.enabled,
      default_parameters: customDefaults,
      param_schema: UNIVERSAL_SCHEMA,
      stats: {
        campaigns_count: agg ? parseInt(agg.campaigns_count, 10) : 0,
        total_sent: agg ? parseInt(agg.total_sent, 10) : 0,
        total_opened: agg ? parseInt(agg.total_opened, 10) : 0,
        total_clicked: agg ? parseInt(agg.total_clicked, 10) : 0,
        total_converted: agg ? parseInt(agg.total_converted, 10) : 0,
        last_run_at: agg?.last_run_at || null,
      },
      campaigns: campaignsByScenario.get(c.kind) || [],
    } as any)
  }

  return NextResponse.json({ scenarios })
}
