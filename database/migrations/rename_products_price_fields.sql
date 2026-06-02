-- Rename sale_price -> price_ex_gst, wholesale_price -> wholeprice_ex_gst on products
-- Rename wholesale_price -> wholeprice_ex_gst on product_variants
-- Add mrp_ex_gst to products; populate all ex-GST fields
-- Idempotent: each RENAME is skipped if source column no longer exists

-- products: sale_price -> price_ex_gst
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'sale_price'
  ) THEN
    ALTER TABLE products RENAME COLUMN sale_price TO price_ex_gst;
  END IF;
END $$;

-- products: wholesale_price -> wholeprice_ex_gst
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'wholesale_price'
  ) THEN
    ALTER TABLE products RENAME COLUMN wholesale_price TO wholeprice_ex_gst;
  END IF;
END $$;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS mrp_ex_gst numeric(12,2);

-- product_variants: wholesale_price -> wholeprice_ex_gst
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_variants' AND column_name = 'wholesale_price'
  ) THEN
    ALTER TABLE product_variants RENAME COLUMN wholesale_price TO wholeprice_ex_gst;
  END IF;
END $$;

-- Populate ex-GST values on products from base_price / mrp (safe to re-run)
UPDATE products
SET
  price_ex_gst = ROUND(base_price / (1 + COALESCE(gst_percentage, 18) / 100), 2),
  mrp_ex_gst   = ROUND(mrp        / (1 + COALESCE(gst_percentage, 18) / 100), 2)
WHERE base_price IS NOT NULL;

UPDATE products
SET wholeprice_ex_gst = ROUND(wholeprice_ex_gst / (1 + COALESCE(gst_percentage, 18) / 100), 2)
WHERE wholeprice_ex_gst IS NOT NULL;

-- Populate wholeprice_ex_gst on product_variants
UPDATE product_variants pv
SET wholeprice_ex_gst = ROUND(pv.wholeprice_ex_gst / (1 + COALESCE(p.gst_percentage, 18) / 100), 2)
FROM products p
WHERE pv.product_id = p.id
  AND pv.wholeprice_ex_gst IS NOT NULL;


