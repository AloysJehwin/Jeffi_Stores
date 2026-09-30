import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/shared/db'
import { runScenario } from '@/lib/campaigns/runner'
import { getScenario } from '@/lib/campaigns/scenarios/_registry'
import { runCustomScenario } from '@/lib/campaigns/custom-runner'
import { getCampaign } from '@/lib/shared/marketing'
import type { SweepResult } from '@/lib/campaigns/types'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

interface CampaignRow {
  kind: string
  scenario_kind: string | null
  enabled: boolean
}

export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const filter = req.nextUrl.searchParams.get('kind')

  const campaigns = await queryMany<CampaignRow>(
    `SELECT kind, scenario_kind, enabled FROM campaigns WHERE enabled = TRUE`
  )

  const targets: Array<{ campaignKind: string; scenarioKind: string }> = []
  for (const c of campaigns) {
    const scenarioKind = c.scenario_kind || c.kind
    if (filter && filter !== c.kind && filter !== scenarioKind) continue
    targets.push({ campaignKind: c.kind, scenarioKind })
  }

  const results: SweepResult[] = []
  try {
    for (const t of targets) {
      const builtin = getScenario(t.scenarioKind)
      if (builtin) {
        results.push(await runScenario(builtin, t.campaignKind))
        continue
      }
      const isCustom = await queryOne<{ enabled: boolean }>(`SELECT enabled FROM custom_scenarios WHERE kind = $1`, [
        t.scenarioKind,
      ])
      if (isCustom?.enabled) {
        const campaign = await getCampaign(t.campaignKind)
        if (campaign) {
          results.push(await runCustomScenario(t.scenarioKind, campaign))
        }
      }
    }
    const totalSent = results.reduce((s, r) => s + r.sent, 0)
    return NextResponse.json({ success: true, totalSent, results })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Sweep failed' }, { status: 500 })
  }
}
