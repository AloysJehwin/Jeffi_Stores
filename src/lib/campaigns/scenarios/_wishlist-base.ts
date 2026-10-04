import { query } from '@/lib/shared/db'
import { PRODUCT_IN_STOCK_SQL } from '@/lib/queries/shared'
import { FREQUENCY_CAP_HOURS } from '../duration'

const RETRYABLE_REASONS = new Set(['frequency_cap', 'send_failed', 'record_failed'])

export function isRetryable(reason: string | undefined): boolean {
  return reason !== undefined && RETRYABLE_REASONS.has(reason)
}

// Expects the campaign kind as $1. canSendMarketing would refuse these users anyway, so they wait their turn.
export const NOT_RECENTLY_EMAILED_SQL = `
  NOT EXISTS (
    SELECT 1 FROM email_campaigns_sent ecs
    WHERE ecs.campaign_kind = $1
      AND ecs.user_id = wi.user_id
      AND ecs.sent_at > NOW() - INTERVAL '${FREQUENCY_CAP_HOURS} hours'
  )
`

export async function syncWishlistSnapshots(): Promise<void> {
  await query(
    `UPDATE wishlist_items wi
        SET snapshot_price = p.base_price,
            snapshot_in_stock = ${PRODUCT_IN_STOCK_SQL},
            snapshot_taken_at = NOW()
       FROM products p
      WHERE p.id = wi.product_id
        AND wi.snapshot_taken_at IS NULL`
  )
  await query(
    `UPDATE wishlist_items wi
        SET snapshot_in_stock = FALSE,
            snapshot_taken_at = NOW()
       FROM products p
      WHERE p.id = wi.product_id
        AND wi.snapshot_in_stock = TRUE
        AND NOT ${PRODUCT_IN_STOCK_SQL}`
  )
}

export async function refreshWishlistSnapshot(userId: string, productId: string): Promise<void> {
  await query(
    `UPDATE wishlist_items wi
        SET snapshot_price = p.base_price,
            snapshot_in_stock = ${PRODUCT_IN_STOCK_SQL},
            snapshot_taken_at = NOW()
       FROM products p
      WHERE p.id = wi.product_id
        AND wi.user_id = $1
        AND wi.product_id = $2`,
    [userId, productId]
  )
}

// A handled event must not fire again; a retryable failure leaves the row pending for the next sweep.
export async function settleWishlistEvent(
  result: { ok: boolean; reason?: string },
  userId: string,
  productId: string
): Promise<void> {
  if (!result.ok && isRetryable(result.reason)) return
  await refreshWishlistSnapshot(userId, productId).catch(() => {})
}
