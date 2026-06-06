-- Backfill variant_id and sub_variant_id on order_items for existing orders.
-- Matches by product_sku against product_variants.sku and product_sub_variants.sku.
-- Only updates rows where variant_id is currently NULL.
-- Rows with blank/null SKU or SKUs no longer in the catalogue are left unchanged.

-- Step 1: assign sub_variant_id + variant_id for items whose SKU matches a sub_variant
UPDATE order_items oi
SET
  sub_variant_id = psv.id,
  variant_id     = psv.variant_id
FROM product_sub_variants psv
WHERE oi.variant_id IS NULL
  AND oi.product_id IS NOT NULL
  AND oi.product_sku IS NOT NULL
  AND oi.product_sku != ''
  AND psv.sku = oi.product_sku;

-- Step 2: assign variant_id for items whose SKU matches a product_variant (and not already set above)
UPDATE order_items oi
SET variant_id = pv.id
FROM product_variants pv
WHERE oi.variant_id IS NULL
  AND oi.product_id IS NOT NULL
  AND oi.product_sku IS NOT NULL
  AND oi.product_sku != ''
  AND pv.sku = oi.product_sku
  AND pv.product_id = oi.product_id;
