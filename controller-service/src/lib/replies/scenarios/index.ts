import 'server-only'
import type { Scenario, ScenarioKey } from '../types'
import { orderAdjustment } from './order-adjustment'
import { quotation } from './quotation'
import { rfqOffer } from './rfq-offer'

const SCENARIOS: Partial<Record<ScenarioKey, Scenario>> = {
  order_adjustment: orderAdjustment,
  quotation,
  rfq_offer: rfqOffer,
}

export function scenarioFor(key: ScenarioKey): Scenario | null {
  return SCENARIOS[key] ?? null
}
