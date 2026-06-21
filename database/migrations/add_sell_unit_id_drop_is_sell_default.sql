-- Add sell_unit_id to product_variants and products
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS sell_unit_id UUID REFERENCES product_units(id) ON DELETE SET NULL;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sell_unit_id UUID REFERENCES product_units(id) ON DELETE SET NULL;

-- Migrate: set sell_unit_id from existing is_sell_default rows
UPDATE product_variants pv
SET sell_unit_id = pu.id
FROM product_units pu
WHERE pu.variant_id = pv.id
  AND pu.is_sell_default = true
  AND pv.sell_unit_id IS NULL;

-- Migrate product-level sell unit (variant_id IS NULL, sub_variant_id IS NULL)
UPDATE products p
SET sell_unit_id = pu.id
FROM product_units pu
WHERE pu.product_id = p.id
  AND pu.variant_id IS NULL
  AND pu.sub_variant_id IS NULL
  AND pu.is_sell_default = true
  AND p.sell_unit_id IS NULL;

-- For products with variants but no product-level sell unit, fall back to is_base
UPDATE products p
SET sell_unit_id = pu.id
FROM product_units pu
WHERE pu.product_id = p.id
  AND pu.variant_id IS NULL
  AND pu.sub_variant_id IS NULL
  AND pu.is_base = true
  AND p.sell_unit_id IS NULL;

-- Drop is_sell_default
ALTER TABLE product_units DROP COLUMN IF EXISTS is_sell_default;
