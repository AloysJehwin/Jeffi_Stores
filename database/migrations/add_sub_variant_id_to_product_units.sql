-- Allow product_units rows to be scoped to a specific sub-variant.
-- sub_variant_id = NULL means the unit applies at variant or product level (existing behaviour).
-- sub_variant_id = <id> means it overrides only for that sub-variant.

ALTER TABLE product_units
  ADD COLUMN IF NOT EXISTS sub_variant_id uuid
    REFERENCES product_sub_variants(id) ON DELETE CASCADE;

-- Index for fast lookup when resolving the sell unit on the storefront.
CREATE INDEX IF NOT EXISTS idx_product_units_sub_variant_id
  ON product_units(sub_variant_id)
  WHERE sub_variant_id IS NOT NULL;

-- Unique constraint so the ON CONFLICT upsert works for sub-variant-scoped units.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_sub_variant_unit
  ON product_units(sub_variant_id, unit)
  WHERE sub_variant_id IS NOT NULL;
