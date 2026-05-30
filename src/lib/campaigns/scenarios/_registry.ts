import type { AnyScenarioModule } from '../types'
import { abandonedCart } from './abandoned-cart'
import { abandonedCheckout } from './abandoned-checkout'
import { postPurchase } from './post-purchase'
import { reviewReminder } from './review-reminder'
import { winback90 } from './winback-90'
import { winback180 } from './winback-180'
import { restock } from './restock'
import { priceDrop } from './price-drop'

export const SCENARIOS: Record<string, AnyScenarioModule> = {
  [abandonedCart.kind]:     abandonedCart as unknown as AnyScenarioModule,
  [abandonedCheckout.kind]: abandonedCheckout as unknown as AnyScenarioModule,
  [postPurchase.kind]:      postPurchase as unknown as AnyScenarioModule,
  [reviewReminder.kind]:    reviewReminder as unknown as AnyScenarioModule,
  [winback90.kind]:         winback90 as unknown as AnyScenarioModule,
  [winback180.kind]:        winback180 as unknown as AnyScenarioModule,
  [restock.kind]:           restock as unknown as AnyScenarioModule,
  [priceDrop.kind]:         priceDrop as unknown as AnyScenarioModule,
}

export function getScenario(kind: string): AnyScenarioModule | null {
  return SCENARIOS[kind] ?? null
}

export function listScenarios(): AnyScenarioModule[] {
  return Object.values(SCENARIOS)
}
