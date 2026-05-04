-- Delhivery integration prep: add weight and dimensions to products and variants
-- weight_grams on product_variants: per-variant shipping weight (primary — varies by size)
-- weight_grams on products: fallback when no variant, or product has no variants

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS weight_grams INTEGER DEFAULT 500,
  ADD COLUMN IF NOT EXISTS length_cm NUMERIC(6,2) DEFAULT 10,
  ADD COLUMN IF NOT EXISTS breadth_cm NUMERIC(6,2) DEFAULT 10,
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(6,2) DEFAULT 10;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS weight_grams INTEGER DEFAULT 500;
