-- Cascade shelf_stock when its sub-variant or variant is deleted.
-- Existing FKs had no ON DELETE clause, so deleting a sub-variant blocked
-- with: "violates foreign key constraint shelf_stock_sub_variant_id_fkey".
-- Stock pointing at a deleted variant is meaningless; the audit trigger on
-- shelf_stock still records each cascaded DELETE so the history survives.

ALTER TABLE shelf_stock
  DROP CONSTRAINT IF EXISTS shelf_stock_sub_variant_id_fkey,
  ADD CONSTRAINT shelf_stock_sub_variant_id_fkey
    FOREIGN KEY (sub_variant_id) REFERENCES product_sub_variants(id) ON DELETE CASCADE;

ALTER TABLE shelf_stock
  DROP CONSTRAINT IF EXISTS shelf_stock_variant_id_fkey,
  ADD CONSTRAINT shelf_stock_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE;

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('cascade_shelf_stock_on_variant_delete.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
