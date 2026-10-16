// Shared by the inventory and purchase-order overviews.

// Sellable leaves (same grains as stock-levels): unit cost = cost price when set, else the
// ex-GST selling price the valuation view uses, flagged has_cost = false.
export const LEAVES = `
WITH leaves AS (
  SELECT p.id AS product_id, NULL::uuid AS variant_id, NULL::uuid AS sub_variant_id,
         p.name, NULL::text AS leaf_name, p.sku,
         COALESCE(p.inventory_quantity, 0) AS qty, p.low_stock_threshold AS threshold,
         NULLIF(p.cost_price, 0) AS cost,
         COALESCE(p.base_price, 0) AS price, COALESCE(p.gst_percentage, 0) AS gst,
         p.supplier_id, p.category_id, p.perishable, p.serialized, p.created_at
  FROM products p
  WHERE p.has_variants = FALSE AND p.is_active = TRUE AND COALESCE(p.is_digital, FALSE) = FALSE
  UNION ALL
  SELECT p.id, pv.id, NULL::uuid, p.name, pv.variant_name, COALESCE(pv.sku, p.sku),
         COALESCE(pv.inventory_quantity, 0), p.low_stock_threshold,
         COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0)),
         COALESCE(pv.price, p.base_price, 0), COALESCE(p.gst_percentage, 0),
         COALESCE(pv.supplier_id, p.supplier_id), p.category_id, p.perishable, p.serialized, LEAST(p.created_at, pv.created_at)
  FROM product_variants pv JOIN products p ON p.id = pv.product_id
  WHERE p.is_active = TRUE AND pv.is_active = TRUE AND COALESCE(p.is_digital, FALSE) = FALSE
    AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = TRUE)
  UNION ALL
  SELECT p.id, pv.id, sv.id, p.name, pv.variant_name || ' / ' || sv.sub_variant_name, sv.sku,
         COALESCE(sv.inventory_quantity, 0), p.low_stock_threshold,
         COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0)),
         COALESCE(sv.price, pv.price, p.base_price, 0), COALESCE(p.gst_percentage, 0),
         COALESCE(sv.supplier_id, pv.supplier_id, p.supplier_id), p.category_id, p.perishable, p.serialized, LEAST(p.created_at, sv.created_at)
  FROM product_sub_variants sv JOIN product_variants pv ON pv.id = sv.variant_id JOIN products p ON p.id = pv.product_id
  WHERE p.is_active = TRUE AND pv.is_active = TRUE AND sv.is_active = TRUE AND COALESCE(p.is_digital, FALSE) = FALSE
),
priced AS (
  SELECT l.*, (l.cost IS NOT NULL) AS has_cost,
         COALESCE(l.cost, ROUND(l.price / (1 + l.gst / 100), 2)) AS unit_cost
  FROM leaves l
)
`
