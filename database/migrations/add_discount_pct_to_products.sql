-- Add discount_pct column to products, variants, sub-variants
ALTER TABLE products             ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE product_variants     ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE product_sub_variants ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) NOT NULL DEFAULT 0;

-- Back-fill: non-Unbrako products where MRP > selling price
UPDATE products p
SET discount_pct = ROUND(((p.mrp - p.base_price) / NULLIF(p.mrp, 0)) * 100, 2)
FROM brands b
WHERE b.id = p.brand_id
  AND UPPER(b.name) != 'UNBRAKO'
  AND p.mrp > 0 AND p.base_price > 0 AND p.base_price < p.mrp;

-- Back-fill variants (brand inherited from parent product)
UPDATE product_variants pv
SET discount_pct = ROUND(((pv.mrp - pv.price) / NULLIF(pv.mrp, 0)) * 100, 2)
FROM products p
JOIN brands b ON b.id = p.brand_id
WHERE pv.product_id = p.id
  AND UPPER(b.name) != 'UNBRAKO'
  AND pv.mrp > 0 AND pv.price > 0 AND pv.price < pv.mrp;

-- Back-fill sub-variants
UPDATE product_sub_variants psv
SET discount_pct = ROUND(((psv.mrp - psv.price) / NULLIF(psv.mrp, 0)) * 100, 2)
FROM product_variants pv
JOIN products p ON p.id = pv.product_id
JOIN brands b ON b.id = p.brand_id
WHERE psv.variant_id = pv.id
  AND UPPER(b.name) != 'UNBRAKO'
  AND psv.mrp > 0 AND psv.price > 0 AND psv.price < psv.mrp;

-- Unbrako: discount_pct stays 0 (default); their "mrp" is a trade/buy price not retail

-- Wholesale price = selling price for all
UPDATE products             SET wholeprice_ex_gst = price_ex_gst WHERE price_ex_gst > 0;
UPDATE product_variants     SET wholeprice_ex_gst = price_ex_gst WHERE price_ex_gst > 0;
UPDATE product_sub_variants SET wholeprice_ex_gst = price_ex_gst WHERE price_ex_gst > 0;
