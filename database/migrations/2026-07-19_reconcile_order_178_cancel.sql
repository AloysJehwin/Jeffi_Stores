-- ============================================================================
-- One-time data reconcile for order f41e07a0 (invoice JS/26-27/178).
--
-- This ONLINE order was cancelled via the old cancel-review path, which restored
-- only aggregate inventory_quantity (+20) and wrote a single aggregate 'return'
-- ledger row — it never reset the 20 serials back to in_stock nor restored the
-- batch's quantity_remaining. Result: 20 serials stuck 'sold', batch qty and
-- central qty inconsistent with the serial truth.
--
-- The cancel-review code is now fixed to delegate to restoreOrderStock, so future
-- cancellations restore serials/batches correctly. This script repairs the one
-- already-broken order to the state a correct restore would have produced:
--   1) 20 serials → in_stock, unlinked from the order.
--   2) Their batch's quantity_remaining bumped by 20 (reversing the sale).
--   3) Central inventory_quantity re-derived from the serial truth for the variant.
--
-- Transactional; targets only this order/variant. Safe to run once.
-- ============================================================================

BEGIN;

-- 1) Reset the 20 still-sold serials for this cancelled order.
UPDATE product_serials
SET status = 'in_stock', order_id = NULL, order_item_id = NULL, sold_at = NULL, updated_at = NOW()
WHERE order_id = 'f41e07a0-e01b-4434-b8a1-caca6f610bdb' AND status = 'sold';

-- 2) Restore the batch quantity_remaining to match its in-stock serial count
--    (serialized source of truth) for every batch those serials belong to.
UPDATE product_batches pb
SET quantity_remaining = sub.in_stock, updated_at = NOW()
FROM (
  SELECT b.id, COUNT(s.id) FILTER (WHERE s.status = 'in_stock') AS in_stock
  FROM product_batches b
  JOIN products p ON p.id = b.product_id AND p.serialized = true
  LEFT JOIN product_serials s ON s.batch_id = b.id
  WHERE b.variant_id = 'd757a759-667c-4391-aad3-52345366c4f4'
  GROUP BY b.id
) sub
WHERE pb.id = sub.id
  AND pb.quantity_remaining IS DISTINCT FROM sub.in_stock;

-- 3) Re-derive the variant's central inventory_quantity from batch totals.
UPDATE product_variants pv
SET inventory_quantity = (
  SELECT COALESCE(SUM(quantity_remaining), 0)
  FROM product_batches b WHERE b.variant_id = pv.id
)
WHERE pv.id = 'd757a759-667c-4391-aad3-52345366c4f4';

COMMIT;
