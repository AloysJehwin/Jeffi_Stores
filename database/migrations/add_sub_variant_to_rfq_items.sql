ALTER TABLE business_rfq_items
  ADD COLUMN IF NOT EXISTS sub_variant_id uuid REFERENCES product_sub_variants(id);

CREATE INDEX IF NOT EXISTS idx_business_rfq_items_sub_variant_id ON business_rfq_items(sub_variant_id);
