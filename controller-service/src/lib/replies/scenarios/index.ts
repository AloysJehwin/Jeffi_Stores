import 'server-only'
import type { Scenario, ScenarioKey } from '../types'
import { orderAdjustment } from './order-adjustment'

const SCENARIOS: Partial<Record<ScenarioKey, Scenario>> = {
  order_adjustment: orderAdjustment,
}

export function scenarioFor(key: ScenarioKey): Scenario | null {
  return SCENARIOS[key] ?? null
}
