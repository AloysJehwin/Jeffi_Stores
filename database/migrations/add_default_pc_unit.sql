-- Insert default 'pc' (Piece/Count) unit for every product/variant/sub-variant
-- that currently has no product_units row at that level.
-- dimension=count, factor=1, is_base=true, display_label='Pc'

-- Product-level: products with no product-level unit row
INSERT INTO product_units (product_id, variant_id, sub_variant_id, unit, factor, dimension, is_base, display_label)
SELECT p.id, NULL, NULL, 'pc', 1, 'count', TRUE, 'Pc'
FROM products p
WHERE p.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM product_units pu
    WHERE pu.product_id = p.id AND pu.variant_id IS NULL AND pu.sub_variant_id IS NULL
  );

-- Variant-level: variants with no variant-level unit row
INSERT INTO product_units (product_id, variant_id, sub_variant_id, unit, factor, dimension, is_base, display_label)
SELECT pv.product_id, pv.id, NULL, 'pc', 1, 'count', TRUE, 'Pc'
FROM product_variants pv
WHERE pv.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM product_units pu
    WHERE pu.variant_id = pv.id
  );

-- Sub-variant-level: sub-variants with no sub-variant-level unit row
-- AND whose parent variant also has no unit row (otherwise they inherit from the variant)
INSERT INTO product_units (product_id, variant_id, sub_variant_id, unit, factor, dimension, is_base, display_label)
SELECT sv.product_id, sv.variant_id, sv.id, 'pc', 1, 'count', TRUE, 'Pc'
FROM product_sub_variants sv
WHERE sv.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM product_units pu
    WHERE pu.sub_variant_id = sv.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM product_units pu
    WHERE pu.variant_id = sv.variant_id
  );
