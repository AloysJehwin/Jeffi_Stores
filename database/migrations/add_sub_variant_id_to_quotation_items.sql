ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS sub_variant_id uuid REFERENCES product_sub_variants(id) ON DELETE SET NULL;
