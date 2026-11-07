import { recordPurchaseOrder } from './purchase-order'
import { recordMarketplaceReturn } from './returns'
import { pushStockAfterOrderEvent } from './stock'
import type { UpsertOutcome } from './upsert'
import type { NormalizedOrder } from './types'

/** What an order event carries beyond the order itself: AJIO's purchase order (our B2B invoice)
 * and returns. Runs after the upsert; throwing leaves the event pending for a retry. */
export async function afterOrderEvent(order: NormalizedOrder, outcome: UpsertOutcome): Promise<void> {
  if (order.po?.number) await recordPurchaseOrder(order)
  await recordMarketplaceReturn(order, outcome)
  if (outcome.stock === 'deduct' || outcome.stock === 'restore') pushStockAfterOrderEvent()
}
