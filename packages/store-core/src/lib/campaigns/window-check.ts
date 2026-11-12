import { getScenario } from '@/lib/campaigns/scenarios/_registry'
import { resolveScenarioParams } from '@/lib/campaigns/runner'
import { readDurationParam, fromMinutes, pickDisplayUnit, UNIT_LABEL } from '@/lib/campaigns/duration'

// Scenarios that match rows older than the campaign delay and newer than a lookback window. A
// lookback no longer than the delay leaves an empty window: nobody is ever eligible or suppressed.
const LOOKBACK_KEYS = ['lookbackDays', 'lookback'] as const

const human = (min: number) => {
  const unit = pickDisplayUnit(min, 'days')
  return `${+fromMinutes(min, unit).toFixed(2)} ${UNIT_LABEL[unit]}`
}

/** Why this scenario can never match (lookback ≤ delay), or null. */
export function emptyWindowProblem(scenarioKind: string, parameters: unknown, delayHours: unknown): string | null {
  const scenario = getScenario(scenarioKind)
  const delayMin = Number(delayHours) * 60
  if (!scenario || !Number.isFinite(delayMin) || delayMin <= 0) return null
  const key = LOOKBACK_KEYS.find(k => (scenario.paramSchema as Record<string, { type?: string }>)?.[k]?.type === 'duration')
  if (!key) return null
  const lookbackMin = readDurationParam(resolveScenarioParams(scenario, parameters), key)
  if (lookbackMin == null || lookbackMin > delayMin) return null
  return `Lookback (${human(lookbackMin)}) must be longer than the delay (${human(delayMin)}): only rows older than the delay and newer than the lookback qualify, so nobody would ever match.`
}
