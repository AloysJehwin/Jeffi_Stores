import { queryOne, queryMany, queryCount } from '../db'

export { queryOne, queryMany, queryCount }

export type AnalyticsRange = 'today' | '7d' | '30d' | '90d' | 'month' | 'year'
export type RevenuePeriod = '3m' | '6m' | '12m' | 'ytd' | 'all'

export const VARIANT_STOCK_TOTAL_SQL = `
  COALESCE((SELECT COUNT(*) FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.is_active = true
    AND (
      (EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
       AND EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.stock_status != 'Out of Stock'))
      OR
      (NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
       AND pv.stock_status != 'Out of Stock')
    )
  ), 0)
`

export const VARIANT_INVENTORY_TOTAL_SQL = `
  COALESCE((SELECT SUM(
    CASE
      WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
      THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
      ELSE pv.inventory_quantity
    END
  ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), 0)
`

export const VARIANT_MIN_PRICE_SQL = `
  (SELECT MIN(price) FROM (
    SELECT pv.price
    FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.is_active = true AND pv.price IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
    UNION ALL
    SELECT sv.price
    FROM product_sub_variants sv
    JOIN product_variants pv ON pv.id = sv.variant_id
    WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.price IS NOT NULL
  ) AS combined_prices)
`

export const VARIANT_MIN_PRICE_INCL_GST_SQL = `
  (SELECT MIN(price) FROM (
    SELECT pv.price
    FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.is_active = true AND pv.price IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
    UNION ALL
    SELECT sv.price
    FROM product_sub_variants sv
    JOIN product_variants pv ON pv.id = sv.variant_id
    WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.price IS NOT NULL
  ) AS combined_prices)
`

// Ex-GST variant of the min-price SQL: prefer the stored ex-GST column, fall
// back to the inclusive price when it is NULL/0. Used by listing pages when the
// GST feature flag is OFF so displayed prices match what checkout will charge.
export const VARIANT_MIN_PRICE_EX_GST_SQL = `
  (SELECT MIN(price) FROM (
    SELECT COALESCE(NULLIF(pv.price_ex_gst, 0), pv.price) AS price
    FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.is_active = true AND pv.price IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
    UNION ALL
    SELECT COALESCE(NULLIF(sv.price_ex_gst, 0), sv.price) AS price
    FROM product_sub_variants sv
    JOIN product_variants pv ON pv.id = sv.variant_id
    WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.price IS NOT NULL
  ) AS combined_prices)
`

export const VARIANT_MIN_MRP_SQL = `
  (SELECT MIN(mrp) FROM (
    SELECT pv.mrp
    FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.is_active = true AND pv.mrp IS NOT NULL AND pv.mrp > 0
      AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
    UNION ALL
    SELECT sv.mrp
    FROM product_sub_variants sv
    JOIN product_variants pv ON pv.id = sv.variant_id
    WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.mrp IS NOT NULL AND sv.mrp > 0
  ) AS combined_mrps)
`

export const EFFECTIVE_STOCK_SQL = `
  CASE
    WHEN p.has_variants = true THEN ${VARIANT_INVENTORY_TOTAL_SQL}
    ELSE COALESCE(p.inventory_quantity, 0)
  END
`

export const EFFECTIVE_PRICE_SQL = `COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price, 0)`
