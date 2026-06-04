ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sub_variant_id uuid REFERENCES product_sub_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_sub_variant_id ON order_items(sub_variant_id);
