-- Replace numeric stock_quantity / low_stock_threshold / is_in_stock
-- with a stock_status enum on products, product_variants, product_sub_variants.
-- Values: 'In Stock', 'Low Stock', 'Out of Stock'

-- ── products ──────────────────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) NOT NULL DEFAULT 'In Stock'
    CHECK (stock_status IN ('In Stock', 'Low Stock', 'Out of Stock'));

UPDATE products SET stock_status =
  CASE
    WHEN stock_quantity = 0                                      THEN 'Out of Stock'
    WHEN stock_quantity <= COALESCE(low_stock_threshold, 10)     THEN 'Low Stock'
    ELSE 'In Stock'
  END;

-- Drop the trigger that fires on stock_quantity before dropping the column
DROP TRIGGER IF EXISTS update_products_stock_status ON products;

ALTER TABLE products DROP COLUMN IF EXISTS stock_quantity;
ALTER TABLE products DROP COLUMN IF EXISTS low_stock_threshold;
ALTER TABLE products DROP COLUMN IF EXISTS is_in_stock;

-- ── product_variants ──────────────────────────────────────────────────────────
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) NOT NULL DEFAULT 'In Stock'
    CHECK (stock_status IN ('In Stock', 'Low Stock', 'Out of Stock'));

UPDATE product_variants SET stock_status =
  CASE
    WHEN stock_quantity = 0 THEN 'Out of Stock'
    WHEN stock_quantity <= 5 THEN 'Low Stock'
    ELSE 'In Stock'
  END;

ALTER TABLE product_variants DROP COLUMN IF EXISTS stock_quantity;

-- ── product_sub_variants ──────────────────────────────────────────────────────
ALTER TABLE product_sub_variants
  ADD COLUMN IF NOT EXISTS stock_status VARCHAR(20) NOT NULL DEFAULT 'In Stock'
    CHECK (stock_status IN ('In Stock', 'Low Stock', 'Out of Stock'));

UPDATE product_sub_variants SET stock_status =
  CASE
    WHEN stock_quantity = 0 THEN 'Out of Stock'
    WHEN stock_quantity <= 5 THEN 'Low Stock'
    ELSE 'In Stock'
  END;

ALTER TABLE product_sub_variants DROP COLUMN IF EXISTS stock_quantity;
