import { query } from '@/lib/shared/db'
import { getCampaign } from '@/lib/shared/marketing'
import type { AnyScenarioModule, ScenarioModule, SweepResult } from './types'
import { resolveParams } from './types'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function resolveScenarioParams<P extends Record<string, unknown>>(
  scenario: Pick<ScenarioModule<P, unknown>, 'defaultParams' | 'paramSchema'>,
  override: unknown
): P {
  // Duration params are stored as canonical minutes by the editor and used verbatim — the saved value
  // is exactly what the admin configured. (The per-user cooldown default, when the key is absent, is
  // applied at read time by cooldownMinutes(); the legacy `sendCooldownDays` key is handled by
  // readDurationParam.)
  return resolveParams(scenario.defaultParams, override)
}

export async function runScenario<P extends Record<string, unknown>, Row>(
  scenario: ScenarioModule<P, Row>,
  campaignKind: string
): Promise<SweepResult> {
  const result: SweepResult = { campaign: campaignKind, attempted: 0, sent: 0, skipped: 0 }

  // A throwing scenario must not abort the rest of the sweep.
  try {
    const campaign = await getCampaign(campaignKind)
    if (!campaign?.enabled) return result

    const params = resolveScenarioParams(scenario, (campaign as any).parameters)
    const rows = await scenario.findEligible({ campaign, params })
    result.attempted = rows.length

    for (const row of rows) {
      try {
        const r = await scenario.send(row, { campaign, params })
        if (r.ok) result.sent++
        else result.skipped++
      } catch (err) {
        result.skipped++
        if (!result.error) result.error = errorMessage(err)
        console.error('[campaigns]', campaignKind, 'send failed', err)
      }
    }
  } catch (err) {
    result.error = errorMessage(err)
    console.error('[campaigns]', campaignKind, err)
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
