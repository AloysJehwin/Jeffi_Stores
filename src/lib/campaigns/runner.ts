import { query } from '@/lib/shared/db'
import { getCampaign } from '@/lib/shared/marketing'
import type { AnyScenarioModule, ScenarioModule, SweepResult } from './types'
import { resolveParams } from './types'

export async function runScenario<P extends Record<string, unknown>, Row>(
  scenario: ScenarioModule<P, Row>,
  campaignKind: string
): Promise<SweepResult> {
  const result: SweepResult = { campaign: campaignKind, attempted: 0, sent: 0, skipped: 0 }

  const campaign = await getCampaign(campaignKind)
  if (!campaign?.enabled) return result

  const params = resolveParams(scenario.defaultParams, (campaign as any).parameters)
  const rows = await scenario.findEligible({ campaign, params })
  result.attempted = rows.length

  for (const row of rows) {
    const r = await scenario.send(row, { campaign, params })
    if (r.ok) result.sent++
    else result.skipped++
  }

  if (result.attempted > 0) {
    await query(`UPDATE campaigns SET last_run_at = NOW() WHERE kind = $1`, [campaignKind]).catch(() => {})
  }

  return result
}

export async function runScenarioForAllCampaigns(scenario: AnyScenarioModule): Promise<SweepResult[]> {
  const { rows } = await query<{ kind: string }>(
    `SELECT kind FROM campaigns WHERE scenario_kind = $1 AND enabled = TRUE`,
    [scenario.kind]
  )
  if (rows.length === 0) return []
  const out: SweepResult[] = []
  for (const r of rows) {
    out.push(await runScenario(scenario, r.kind))
  }
  return out
}
