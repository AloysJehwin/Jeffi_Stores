-- Rename sale_price -> price_ex_gst, add mrp_ex_gst
-- Populates price_ex_gst and mrp_ex_gst from price/mrp using product gst_percentage

ALTER TABLE product_variants
  RENAME COLUMN sale_price TO price_ex_gst;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS mrp_ex_gst numeric(12,2);

-- Populate ex-GST values
UPDATE product_variants pv
SET
  price_ex_gst = ROUND(pv.price / (1 + COALESCE(p.gst_percentage, 18) / 100), 2),
  mrp_ex_gst   = ROUND(pv.mrp   / (1 + COALESCE(p.gst_percentage, 18) / 100), 2)
FROM products p
WHERE pv.product_id = p.id
  AND pv.price IS NOT NULL;
