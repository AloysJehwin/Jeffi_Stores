ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS sub_variant_id uuid REFERENCES product_sub_variants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_inv_sub_variant_id ON inventory_transactions(sub_variant_id);
