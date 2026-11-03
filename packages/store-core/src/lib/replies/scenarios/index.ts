import 'server-only'
import type { Scenario, ScenarioKey } from '../types'
import { orderAdjustment } from './order-adjustment'
import { quotation } from './quotation'
import { rfqOffer } from './rfq-offer'
import { invoicePayment, paymentFailed } from './payment'
import { orderDelay } from './order-delay'
import { outOfStock } from './out-of-stock'
import { subscriptionRenewal } from './subscription-renewal'

const SCENARIOS: Partial<Record<ScenarioKey, Scenario>> = {
  order_adjustment: orderAdjustment,
  quotation,
  rfq_offer: rfqOffer,
  invoice_payment: invoicePayment,
  payment_failed: paymentFailed,
  order_delay: orderDelay,
  out_of_stock: outOfStock,
  subscription_renewal: subscriptionRenewal,
}

export function scenarioFor(key: ScenarioKey): Scenario | null {
  return SCENARIOS[key] ?? null
}
