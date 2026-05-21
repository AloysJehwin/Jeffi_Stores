-- Rename sale_price -> price_ex_gst, add mrp_ex_gst
-- price_ex_gst and mrp_ex_gst will be populated separately once confirmed

ALTER TABLE product_variants
  RENAME COLUMN sale_price TO price_ex_gst;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS mrp_ex_gst numeric(12,2);
