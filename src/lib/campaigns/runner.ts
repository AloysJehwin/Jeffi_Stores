import { query } from '@/lib/shared/db'
import { getCampaign } from '@/lib/shared/marketing'
import type { AnyScenarioModule, ParamDef, ScenarioModule, SweepResult } from './types'
import { resolveParams } from './types'
import { UNIVERSAL_SCHEMA } from './universal-params'
import { toMinutes, type DurationUnit } from './duration'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function legacyUnit(key: string, def: Extract<ParamDef, { type: 'duration' }>): DurationUnit {
  if (/Days$/.test(key)) return 'days'
  if (/Hours$/.test(key)) return 'hours'
  if (/Minutes$/.test(key)) return 'minutes'
  return def.recommendedUnit
}

// Duration params are canonical minutes, but rows saved before that change hold a bare count in the
// key's own unit (lookbackDays: 30 meant 30 days, now read as 30 minutes, so the campaign never
// matched anyone). A number below the field's minimum can't be a value the editor saved, so read it
// in the legacy unit instead.
export function normalizeDurationParams<P extends Record<string, unknown>>(
  params: P,
  schema: Record<string, ParamDef>
): P {
  const out: Record<string, unknown> = { ...params }
  for (const [key, def] of Object.entries({ ...UNIVERSAL_SCHEMA, ...schema })) {
    if (def.type !== 'duration' || typeof def.min !== 'number') continue
    const v = out[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v >= def.min) continue
    const converted = toMinutes(v, legacyUnit(key, def))
    if (converted >= def.min) out[key] = converted
  }
  return out as P
}

export function resolveScenarioParams<P extends Record<string, unknown>>(
  scenario: Pick<ScenarioModule<P, unknown>, 'defaultParams' | 'paramSchema'>,
  override: unknown
): P {
  return normalizeDurationParams(resolveParams(scenario.defaultParams, override), scenario.paramSchema as Record<string, ParamDef>)
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
