-- Pre-check: abort if any case-only duplicate SKUs exist (would violate unique constraint)
DO $$
BEGIN
  IF EXISTS (
    SELECT UPPER(sku) FROM products GROUP BY UPPER(sku) HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'products table has case-only duplicate SKUs — resolve before running migration';
  END IF;
  IF EXISTS (
    SELECT UPPER(sku) FROM product_variants GROUP BY UPPER(sku) HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'product_variants table has case-only duplicate SKUs — resolve before running migration';
  END IF;
END $$;

UPDATE products SET sku = UPPER(sku) WHERE sku != UPPER(sku);
UPDATE product_variants SET sku = UPPER(sku) WHERE sku != UPPER(sku);
