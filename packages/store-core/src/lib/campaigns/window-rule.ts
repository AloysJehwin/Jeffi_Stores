import { readDurationParam, fromMinutes, pickDisplayUnit, UNIT_LABEL } from './duration'
import { resolveParams, type AnyScenarioModule } from './types'

// Scenarios that match rows older than the campaign delay and newer than a lookback window. A
// lookback no longer than the delay leaves an empty window: nobody is ever eligible or suppressed.
const LOOKBACK_KEYS = ['lookbackDays', 'lookback'] as const

const human = (min: number) => {
  const unit = pickDisplayUnit(min, 'days')
  return `${+fromMinutes(min, unit).toFixed(2)} ${UNIT_LABEL[unit]}`
}

/** Why this scenario's saved parameters can never match (lookback ≤ delay), or null. */
export function emptyWindowFor(scenario: Pick<AnyScenarioModule, 'defaultParams' | 'paramSchema'>, parameters: unknown, delayHours: unknown): string | null {
  const delayMin = Number(delayHours) * 60
  if (!Number.isFinite(delayMin) || delayMin <= 0) return null
  const key = LOOKBACK_KEYS.find(k => (scenario.paramSchema as Record<string, { type?: string }>)?.[k]?.type === 'duration')
  if (!key) return null
  const lookbackMin = readDurationParam(resolveParams(scenario.defaultParams as Record<string, unknown>, parameters), key)
  if (lookbackMin == null || lookbackMin > delayMin) return null
  return `Lookback (${human(lookbackMin)}) must be longer than the delay (${human(delayMin)}): only rows older than the delay and newer than the lookback qualify, so nobody would ever match.`
}
