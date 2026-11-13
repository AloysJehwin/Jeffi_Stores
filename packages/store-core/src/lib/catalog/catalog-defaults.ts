// What a product inherits from its brand and category when it leaves a field blank
// (docs/BRAND_CATEGORY_PLAN.md §5). Pure helpers plus SQL fragments; no DB import.
import { BRAND_PRODUCT_DEFAULTS } from './brand-fields'

/** `json_build_object(...) AS brand_defaults` for a query that joins brands as `b`. */
export const BRAND_DEFAULTS_SQL = `json_build_object(${Object.keys(BRAND_PRODUCT_DEFAULTS)
  .map(k => `'${k}', b.${k}`)
  .join(', ')}) AS brand_defaults`

/** Category HSN for products (nearest ancestor that sets one); $1 = uuid[] of product ids. */
export const CATEGORY_HSN_SQL = `SELECT p.id::text AS id,
       COALESCE(NULLIF(c.default_hsn_code, ''), NULLIF(pc.default_hsn_code, '')) AS hsn
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN categories pc ON pc.id = c.parent_category_id
 WHERE p.id = ANY($1::uuid[])`

const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '')

/**
 * Fills a product row's blank fields from `row.brand_defaults` (selected with BRAND_DEFAULTS_SQL) and
 * drops that key. `inherited` lists which product fields came from the brand.
 */
export function withBrandDefaults<T extends Record<string, any>>(row: T): T & { inherited?: Record<string, 'brand'> } {
  if (!row || typeof row !== 'object') return row
  const defaults = row.brand_defaults as Record<string, unknown> | null | undefined
  const { brand_defaults: _drop, ...rest } = row as Record<string, any>
  if (!defaults) return rest as T
  const inherited: Record<string, 'brand'> = {}
  for (const [brandKey, productKey] of Object.entries(BRAND_PRODUCT_DEFAULTS)) {
    if (blank(rest[productKey]) && !blank(defaults[brandKey])) {
      rest[productKey] = defaults[brandKey]
      inherited[productKey] = 'brand'
    }
  }
  return (Object.keys(inherited).length ? { ...rest, inherited } : rest) as T & { inherited?: Record<string, 'brand'> }
}
