-- Rename sale_price -> price_ex_gst on product_variants, add mrp_ex_gst
-- Idempotent: RENAME is skipped if source column no longer exists

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_variants' AND column_name = 'sale_price'
  ) THEN
    ALTER TABLE product_variants RENAME COLUMN sale_price TO price_ex_gst;
  END IF;
END $$;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS mrp_ex_gst numeric(12,2);

-- Populate ex-GST values (safe to re-run — overwrites with same computed value)
UPDATE product_variants pv
SET
  price_ex_gst = ROUND(pv.price / (1 + COALESCE(p.gst_percentage, 18) / 100), 2),
  mrp_ex_gst   = ROUND(pv.mrp   / (1 + COALESCE(p.gst_percentage, 18) / 100), 2)
FROM products p
WHERE pv.product_id = p.id
  AND pv.price IS NOT NULL;
-- migrated
