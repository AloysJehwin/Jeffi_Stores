-- Cascade behaviour for variant / sub-variant deletes across all related tables.
-- The previous migration handled shelf_stock; this one cleans up the rest.
--
-- History/audit tables → SET NULL: preserve the historical row, just unlink
--   the deleted variant. The line items still show their snapshotted name,
--   description, price, quantity, etc. (those columns are denormalised on
--   the document table itself).
-- Live commercial documents (open POs) → leave RESTRICT: admin should resolve
--   open commitments before the variant disappears.

-- shelf_stock_transactions: ledger of every shelf movement
ALTER TABLE shelf_stock_transactions
  DROP CONSTRAINT IF EXISTS shelf_stock_transactions_sub_variant_id_fkey,
  ADD CONSTRAINT shelf_stock_transactions_sub_variant_id_fkey
    FOREIGN KEY (sub_variant_id) REFERENCES product_sub_variants(id) ON DELETE SET NULL;

ALTER TABLE shelf_stock_transactions
  DROP CONSTRAINT IF EXISTS shelf_stock_transactions_variant_id_fkey,
  ADD CONSTRAINT shelf_stock_transactions_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;

-- business_rfq_items: B2B request-for-quote line items
ALTER TABLE business_rfq_items
  DROP CONSTRAINT IF EXISTS business_rfq_items_sub_variant_id_fkey,
  ADD CONSTRAINT business_rfq_items_sub_variant_id_fkey
    FOREIGN KEY (sub_variant_id) REFERENCES product_sub_variants(id) ON DELETE SET NULL;

ALTER TABLE business_rfq_items
  DROP CONSTRAINT IF EXISTS business_rfq_items_variant_id_fkey,
  ADD CONSTRAINT business_rfq_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;

-- grn_items: goods receipt note items
ALTER TABLE grn_items
  DROP CONSTRAINT IF EXISTS grn_items_variant_id_fkey,
  ADD CONSTRAINT grn_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;

-- purchase_order_items: keep RESTRICT (the existing constraint is already
-- RESTRICT). Admin should close open POs before deleting a variant.

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('cascade_variant_fk_history_tables.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
