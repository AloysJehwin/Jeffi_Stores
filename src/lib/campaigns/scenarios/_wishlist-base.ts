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

// What a customer has set aside to buy later: wishlist rows plus cart items moved to "save for later".
// One row per user and product (a saved cart item can repeat across variants, and a product can sit in
// both places), preferring the wishlist row. Use it in place of a table, aliased as wi.
export const SAVED_ITEMS_SQL = `
  (SELECT DISTINCT ON (s.user_id, s.product_id) s.*
     FROM (
       SELECT user_id, product_id, created_at AS saved_at, 'wishlist' AS source, 0 AS source_rank,
              snapshot_price, snapshot_in_stock, snapshot_taken_at
         FROM wishlist_items
       UNION ALL
       SELECT user_id, product_id, COALESCE(saved_at, updated_at, created_at), 'cart', 1,
              snapshot_price, snapshot_in_stock, snapshot_taken_at
         FROM cart_items
        WHERE saved_for_later = TRUE
     ) s
    WHERE s.user_id IS NOT NULL AND s.product_id IS NOT NULL
    ORDER BY s.user_id, s.product_id, s.source_rank, s.snapshot_taken_at ASC NULLS LAST)
`

// Both tables carry the same snapshot columns; cart rows only while saved for later.
const SNAPSHOT_TABLES = [
  { table: 'wishlist_items', saved: 'TRUE' },
  { table: 'cart_items', saved: 'wi.saved_for_later = TRUE' },
] as const

export async function syncWishlistSnapshots(): Promise<void> {
  // A cart item moved back into the cart drops its baseline, so saving it again starts fresh.
  await query(
    `UPDATE cart_items
        SET snapshot_price = NULL, snapshot_in_stock = NULL, snapshot_taken_at = NULL
      WHERE saved_for_later = FALSE
        AND snapshot_taken_at IS NOT NULL`
  )
  for (const { table, saved } of SNAPSHOT_TABLES) {
    await query(
      `UPDATE ${table} wi
          SET snapshot_price = p.base_price,
              snapshot_in_stock = ${PRODUCT_IN_STOCK_SQL},
              snapshot_taken_at = NOW()
         FROM products p
        WHERE p.id = wi.product_id
          AND ${saved}
          AND wi.snapshot_taken_at IS NULL`
    )
    await query(
      `UPDATE ${table} wi
          SET snapshot_in_stock = FALSE,
              snapshot_taken_at = NOW()
         FROM products p
        WHERE p.id = wi.product_id
          AND ${saved}
          AND wi.snapshot_in_stock = TRUE
          AND NOT ${PRODUCT_IN_STOCK_SQL}`
    )
  }
}

export async function refreshWishlistSnapshot(userId: string, productId: string): Promise<void> {
  for (const { table, saved } of SNAPSHOT_TABLES) {
    await query(
      `UPDATE ${table} wi
          SET snapshot_price = p.base_price,
              snapshot_in_stock = ${PRODUCT_IN_STOCK_SQL},
              snapshot_taken_at = NOW()
         FROM products p
        WHERE p.id = wi.product_id
          AND ${saved}
          AND wi.user_id = $1
          AND wi.product_id = $2`,
      [userId, productId]
    )
  }
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
