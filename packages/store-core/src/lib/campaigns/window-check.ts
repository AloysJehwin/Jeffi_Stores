import { getScenario } from '@/lib/campaigns/scenarios/_registry'
import { emptyWindowFor } from './window-rule'

/** Why this scenario can never match (lookback ≤ delay), or null. */
export function emptyWindowProblem(scenarioKind: string, parameters: unknown, delayHours: unknown): string | null {
  const scenario = getScenario(scenarioKind)
  return scenario ? emptyWindowFor(scenario, parameters, delayHours) : null
}
