import type { PoolClient } from 'pg'
import { query, withTransaction } from '@/lib/shared/db'

// Hard-delete a product and every referencing record inside a transaction. Order matters:
// non-cascading / RESTRICT FKs (GRN → PO line items, shelf stock, RFQ items) must be cleared
// before the product row, matched by product_id AND by the product's variant ids. The product
// delete then cascades to variants/sub-variants/units/images/cart/wishlist/views/reviews/drafts/
// inventory/notify/ai logs; historical order_items / quotation_items keep their row with the
// reference nulled (ON DELETE SET NULL). Shared by the admin delete route and the Google-sheet
// orphan reconcile so both stay in lockstep.
export async function deleteProductCascadeTx(client: PoolClient, productId: string): Promise<void> {
  await client.query(
    `DELETE FROM grn_items
     WHERE product_id = $1
        OR variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)`,
    [productId]
  )
  await client.query(
    `DELETE FROM purchase_order_items
     WHERE product_id = $1
        OR variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)`,
    [productId]
  )
  await client.query(`DELETE FROM shelf_stock_transactions WHERE product_id = $1`, [productId])
  await client.query(`DELETE FROM shelf_stock WHERE product_id = $1`, [productId])
  await client.query(`DELETE FROM business_rfq_items WHERE product_id = $1`, [productId])
  await client.query(`DELETE FROM products WHERE id = $1`, [productId])
}

// Whether a product is referenced by order or purchase history. Such products are deactivated
// (is_active=false) rather than hard-deleted, mirroring how publishProductDraft retires removed
// variants — never destroy a row that order/PO history points at.
export async function productHasHistory(productId: string): Promise<boolean> {
  const res = await query<{ n: string }>(
    `SELECT
       (SELECT count(*) FROM order_items WHERE product_id = $1)
       + (SELECT count(*) FROM purchase_order_items WHERE product_id = $1) AS n`,
    [productId]
  )
  return Number(res.rows[0]?.n ?? 0) > 0
}

// Remove a product the way the sheet reconcile wants: deactivate if it has order/PO history,
// otherwise hard-delete. Returns which action was taken.
export async function retireProduct(productId: string): Promise<'deactivated' | 'deleted'> {
  if (await productHasHistory(productId)) {
    await query(`UPDATE products SET is_active = false, updated_at = now() WHERE id = $1`, [productId])
    return 'deactivated'
  }
  await withTransaction(client => deleteProductCascadeTx(client, productId))
  return 'deleted'
}
