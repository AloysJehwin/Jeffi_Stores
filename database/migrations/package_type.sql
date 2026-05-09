ALTER TABLE products
  ADD COLUMN IF NOT EXISTS package_type VARCHAR(30);

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS package_type VARCHAR(30);
