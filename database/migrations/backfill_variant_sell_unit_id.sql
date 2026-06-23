-- Backfill sell_unit_id on product_variants that have a variant-specific base
-- unit row but no explicit sell_unit_id pointer yet.
-- Safe to re-run: only touches rows where sell_unit_id IS NULL.

UPDATE product_variants pv
SET sell_unit_id = pu.id
FROM product_units pu
WHERE pu.variant_id = pv.id
  AND pu.is_base = true
  AND pv.sell_unit_id IS NULL;
