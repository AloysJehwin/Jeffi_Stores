-- product_units becomes product-level by default, variant-level by exception.
-- variant_id NULL means "applies to every variant of this product".
-- variant_id NOT NULL is a per-variant override that beats the product-level
-- row for the same unit name.
--
-- After migration: collapse the 14k variant-level rows from the Phase-1
-- backfill into product-level rows when every variant of a product had the
-- same base unit (which is the usual case).

-- Drop the old unique index (variant_id, unit) — we replace it with two
-- partial uniques: one for product-level rows, one for variant-level rows.
ALTER TABLE product_units DROP CONSTRAINT IF EXISTS product_units_variant_id_unit_key;
DROP INDEX IF EXISTS product_units_variant_id_unit_key;

-- Allow NULL variant_id
ALTER TABLE product_units ALTER COLUMN variant_id DROP NOT NULL;

-- Partial uniques so each (product, unit) is unique at the product level
-- AND each (variant, unit) is unique at the variant level. Both rows can
-- coexist for the same unit name — the variant row wins for that variant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_product_unit
  ON product_units (product_id, unit)
  WHERE variant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_variant_unit
  ON product_units (variant_id, unit)
  WHERE variant_id IS NOT NULL;

-- The is_base / is_sell_default / is_purchase_default partial uniques from
-- the original migration must also become product-aware. Each scope
-- (product-level OR a specific variant) gets its own one-of-each.
DROP INDEX IF EXISTS uniq_product_units_one_base_per_variant;
DROP INDEX IF EXISTS uniq_product_units_one_sell_default_per_variant;
DROP INDEX IF EXISTS uniq_product_units_one_purchase_default_per_variant;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_one_base_product
  ON product_units (product_id) WHERE is_base = TRUE AND variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_one_base_variant
  ON product_units (variant_id) WHERE is_base = TRUE AND variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_one_sell_product
  ON product_units (product_id) WHERE is_sell_default = TRUE AND variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_one_sell_variant
  ON product_units (variant_id) WHERE is_sell_default = TRUE AND variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_one_purchase_product
  ON product_units (product_id) WHERE is_purchase_default = TRUE AND variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_one_purchase_variant
  ON product_units (variant_id) WHERE is_purchase_default = TRUE AND variant_id IS NOT NULL;

-- Collapse: where every variant of a product agrees on the unit string in
-- their backfilled rows, replace those rows with ONE product-level row.
-- Conservative: only collapse if the product has variant-level rows AND no
-- product-level row exists yet AND every variant row matches on
-- (unit, dimension, factor, is_base, is_sell_default, is_purchase_default,
--  price_override, conversion_meta).
WITH candidates AS (
  SELECT
    pu.product_id,
    pu.unit,
    pu.dimension,
    pu.factor,
    pu.is_base,
    pu.is_sell_default,
    pu.is_purchase_default,
    pu.price_override,
    pu.display_label,
    pu.conversion_meta,
    COUNT(*) AS row_count,
    COUNT(DISTINCT pu.variant_id) AS variant_count
  FROM product_units pu
  WHERE pu.variant_id IS NOT NULL
  GROUP BY 1,2,3,4,5,6,7,8,9,10
), variant_count_per_product AS (
  SELECT product_id, COUNT(*) AS total_variants FROM product_variants GROUP BY product_id
), uniform_products AS (
  -- Products whose variant-level rows all share the same single config
  -- AND cover every variant of the product.
  SELECT c.product_id, c.unit, c.dimension, c.factor, c.is_base, c.is_sell_default,
         c.is_purchase_default, c.price_override, c.display_label, c.conversion_meta
  FROM candidates c
  JOIN variant_count_per_product v ON v.product_id = c.product_id
  WHERE c.variant_count = v.total_variants
    AND NOT EXISTS (
      SELECT 1 FROM product_units pu2
      WHERE pu2.product_id = c.product_id AND pu2.variant_id IS NULL
    )
    AND (SELECT COUNT(*) FROM candidates c2 WHERE c2.product_id = c.product_id) = 1
)
INSERT INTO product_units (
  product_id, variant_id, unit, factor, dimension, conversion_meta,
  is_base, is_sell_default, is_purchase_default, price_override, display_label
)
SELECT product_id, NULL, unit, factor, dimension, conversion_meta,
       is_base, is_sell_default, is_purchase_default, price_override, display_label
FROM uniform_products;

-- Now delete the variant-level rows for those uniform products.
DELETE FROM product_units pu
USING product_units pl
WHERE pu.variant_id IS NOT NULL
  AND pl.product_id = pu.product_id
  AND pl.variant_id IS NULL
  AND pl.unit = pu.unit;

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('product_level_units.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
