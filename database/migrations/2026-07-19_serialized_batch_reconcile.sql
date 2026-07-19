-- ============================================================================
-- Migration: reconcile serialized product_batches.quantity_remaining and drop
-- emptied batches.
--
-- For a serialized product, a batch's quantity_remaining MUST equal the number
-- of its serials still in stock. Earlier sales through the buggy online
-- confirmed→processing path (see orders/[id] fix) decremented quantity_remaining
-- by an aggregate amount instead of -1 per serial on each serial's own batch, so
-- some batches drifted (e.g. all serials sold but quantity_remaining > 0). This
-- left fully-sold batches lingering in stock views.
--
-- Steps:
--   1) Set each serialized batch's quantity_remaining = count of its in_stock
--      serials (the source of truth for serialized stock).
--   2) Delete any batch now at quantity_remaining <= 0. Safe: inventory_transactions
--      snapshots lot_number/expiry_date/serial_number, and the FKs on
--      product_serials/order_items/inventory_transactions.batch_id are
--      ON DELETE SET NULL — sold-serial lot history survives in the ledger.
--
-- Idempotent, transactional. Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/2026-07-19_serialized_batch_reconcile.sql
-- ============================================================================

BEGIN;

-- 1) Reconcile quantity_remaining to the in-stock serial count (serialized only).
UPDATE product_batches pb
SET quantity_remaining = sub.in_stock, updated_at = NOW()
FROM (
  SELECT b.id,
         COUNT(s.id) FILTER (WHERE s.status = 'in_stock') AS in_stock
  FROM product_batches b
  JOIN products p ON p.id = b.product_id AND p.serialized = true
  LEFT JOIN product_serials s ON s.batch_id = b.id
  GROUP BY b.id
) sub
WHERE pb.id = sub.id
  AND pb.quantity_remaining IS DISTINCT FROM sub.in_stock;

-- 2) Remove serialized batches that are now fully consumed.
DELETE FROM product_batches pb
USING products p
WHERE p.id = pb.product_id
  AND p.serialized = true
  AND pb.quantity_remaining <= 0;

COMMIT;
