import 'server-only'
import type { Scenario, ScenarioKey } from '../types'
import { orderAdjustment } from './order-adjustment'
import { quotation } from './quotation'
import { rfqOffer } from './rfq-offer'
import { invoicePayment, paymentFailed } from './payment'

const SCENARIOS: Partial<Record<ScenarioKey, Scenario>> = {
  order_adjustment: orderAdjustment,
  quotation,
  rfq_offer: rfqOffer,
  invoice_payment: invoicePayment,
  payment_failed: paymentFailed,
}

export function scenarioFor(key: ScenarioKey): Scenario | null {
  return SCENARIOS[key] ?? null
}
