import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { normalizeProductSort } from '@jeffi/api-contracts'

// Product listing ORDER BY, shared by every listing (contract: @jeffi/api-contracts PRODUCT_SORTS).

/** A positive integer from a query param, else `fallback`; capped at `max`. */
export function positiveInt(raw: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback
}

// SQL below expects the aliases p (products), c (its category) and pc (c's parent category).

export const FEATURED_ORDER_SQL = `p.is_featured DESC, COALESCE(pc.display_order, c.display_order, 9999) ASC, c.display_order ASC, p.created_at DESC`

/** The price a listing card shows: the cheapest active variant, else the product's own (GST-flag aware). */
export function productPriceSql(gstEnabled: boolean): string {
  const own = gstEnabled ? 'p.base_price' : 'COALESCE(NULLIF(p.price_ex_gst, 0), p.base_price)'
  const variants = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
  return `(CASE WHEN p.has_variants THEN COALESCE(${variants}, ${own}) ELSE ${own} END)`
}

/** MRP discount as a fraction of MRP, on the same GST basis as productPriceSql (the table view's Off column). */
function productDiscountSql(gstEnabled: boolean): string {
  const rawMrp = `(CASE WHEN p.has_variants THEN ${VARIANT_MIN_MRP_SQL} ELSE NULLIF(p.mrp, 0) END)`
  const mrp = gstEnabled ? rawMrp : `(${rawMrp} / (1 + COALESCE(p.gst_percentage, 0) / 100.0))`
  const price = productPriceSql(gstEnabled)
  return `(CASE WHEN ${mrp} > ${price} THEN (${mrp} - ${price}) / ${mrp} ELSE 0 END)`
}

/** The table view's stock badge as a rank: in stock 2, low stock 1, out of stock 0. */
const PRODUCT_STOCK_RANK_SQL = `(CASE
    WHEN p.stock_status = 'Out of Stock' OR (p.has_variants AND ${VARIANT_STOCK_TOTAL_SQL} = 0) THEN 0
    WHEN p.stock_status = 'Low Stock' THEN 1
    ELSE 2
  END)`

export type ProductSortQuery = { sort?: unknown; dir?: unknown; order?: unknown }

// discount and stock are the table view's column sorts (PRODUCT_TABLE_COLUMNS).
const PRODUCT_SORT_DEFAULT_DIR: Record<string, 'asc' | 'desc'> = {
  created_at: 'desc',
  price: 'asc',
  name: 'asc',
  category: 'asc',
  discount: 'desc',
  stock: 'desc',
}

/** `sort <dir> NULLS LAST` for a whitelisted ?sort (aliases: base_price, newest; `order` = `dir`), else null. */
export function productSortSql(q: ProductSortQuery, gstEnabled: boolean): string | null {
  const key = normalizeProductSort(typeof q.sort === 'string' ? q.sort : '')
  if (!key || !Object.hasOwn(PRODUCT_SORT_DEFAULT_DIR, key)) return null
  const raw = String(q.dir || q.order || '').toLowerCase()
  const dir = (raw === 'asc' || raw === 'desc' ? raw : PRODUCT_SORT_DEFAULT_DIR[key]).toUpperCase()
  // category = the listing's group-by-category view: category name, then product name.
  if (key === 'category') return `c.name ${dir} NULLS LAST, p.name ASC`
  const col =
    key === 'price'
      ? productPriceSql(gstEnabled)
      : key === 'discount'
        ? productDiscountSql(gstEnabled)
        : key === 'stock'
          ? PRODUCT_STOCK_RANK_SQL
          : `p.${key}`
  return `${col} ${dir} NULLS LAST`
}

/** ORDER BY body for a product listing: the requested sort, else `fallback` (featured), then p.id. */
export function productOrderBy(
  q: ProductSortQuery,
  { gstEnabled, fallback = FEATURED_ORDER_SQL }: { gstEnabled: boolean; fallback?: string }
): string {
  return `${productSortSql(q, gstEnabled) ?? fallback}, p.id ASC`
}
