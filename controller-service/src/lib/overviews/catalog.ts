import type { Period } from '@/lib/overview/period'

// Shared catalogue overview SQL and helpers (products, categories, brands, offers).
// Sales follow the Finance overview: paid orders not cancelled/returned/draft, dated by
// COALESCE(invoice_date, created_at) in IST. Line value is order_items.total_price (incl. GST);
// margin is ex-GST (taxable_amount, else total / (1 + gst_rate)) minus cost, on costed lines only.

export const INACTIVE_ORDER = `('cancelled', 'returned', 'draft', 'cancel_rejected')`
const IST = `'Asia/Kolkata'`

/** IST day bounds for $a..$b (inclusive days) as a timestamptz range test on `expr`. */
export const inIst = (expr: string, a: number, b: number) =>
  `${expr} >= ($${a}::date::timestamp AT TIME ZONE ${IST}) AND ${expr} < (($${b}::date + 1)::timestamp AT TIME ZONE ${IST})`

export const istDay = (expr: string) => `(${expr} AT TIME ZONE ${IST})::date`

export const ORDER_DATE = `COALESCE(o.invoice_date, o.created_at)`

/** Sold order lines, with `cur` true for the current period. Params: $1/$2 current, $3/$4 previous.
 * `extra` narrows the lines (e.g. to the products list's filters). */
export const soldLines = (extra = '') => `
  sold AS (
    SELECT oi.product_id, oi.variant_id, oi.sub_variant_id, oi.order_id, oi.quantity,
           oi.total_price AS value,
           CASE WHEN COALESCE(oi.taxable_amount, 0) > 0 THEN oi.taxable_amount
                ELSE oi.total_price / (1 + COALESCE(oi.gst_rate, 0) / 100) END AS net,
           oi.quantity * COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0)) AS cost,
           ${istDay(ORDER_DATE)} AS d,
           (${inIst(ORDER_DATE, 1, 2)}) AS cur,
           ${ORDER_DATE} AS at
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    WHERE o.payment_status = 'paid' AND o.status NOT IN ${INACTIVE_ORDER}
      AND (${inIst(ORDER_DATE, 1, 2)} OR ${inIst(ORDER_DATE, 3, 4)})${extra}
  )`
export const SOLD_LINES = soldLines()

/** Sellable leaves of active, non-draft, physical products with stock at cost; same grains and
 * cost fallback (ex-GST price when no cost) as the Inventory overview. */
export const LEAVES = `
  leaves AS (
    SELECT p.id AS product_id, p.category_id, p.brand_id,
           GREATEST(COALESCE(p.inventory_quantity, 0), 0) AS qty,
           COALESCE(NULLIF(p.cost_price, 0), ROUND(COALESCE(p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2)) AS unit_cost
    FROM products p
    WHERE p.has_variants = FALSE AND p.is_active AND NOT p.is_draft AND NOT COALESCE(p.is_digital, FALSE)
    UNION ALL
    SELECT p.id, p.category_id, p.brand_id, GREATEST(COALESCE(pv.inventory_quantity, 0), 0),
           COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0),
                    ROUND(COALESCE(pv.price, p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2))
    FROM product_variants pv JOIN products p ON p.id = pv.product_id
    WHERE p.is_active AND NOT p.is_draft AND pv.is_active AND NOT COALESCE(p.is_digital, FALSE)
      AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active)
    UNION ALL
    SELECT p.id, p.category_id, p.brand_id, GREATEST(COALESCE(sv.inventory_quantity, 0), 0),
           COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0),
                    ROUND(COALESCE(sv.price, pv.price, p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2))
    FROM product_sub_variants sv JOIN product_variants pv ON pv.id = sv.variant_id JOIN products p ON p.id = pv.product_id
    WHERE p.is_active AND NOT p.is_draft AND pv.is_active AND sv.is_active AND NOT COALESCE(p.is_digital, FALSE)
  )`

export const num = (v: unknown) => (v == null ? 0 : Number(v) || 0)
export const numOrNull = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** Gross margin share, null without costed sales. */
export const margin = (net: number, cost: number) => (net > 0 && cost > 0 ? (net - cost) / net : null)

/** Price change as a fraction, null unless both prices are positive. */
export function priceChange(from: unknown, to: unknown): number | null {
  const a = numOrNull(from)
  const b = numOrNull(to)
  return a != null && b != null && a > 0 && b > 0 ? (b - a) / a : null
}

export type ListTab = 'overview' | 'list'
const NON_LIST_PARAMS = new Set(['tab', 'from', 'to'])

/** Overview is the default tab; any list param (filter, search, page, sort) on an old URL opens the list. */
export function resolveListTab(sp: Record<string, string | string[] | undefined>): ListTab {
  const tab = typeof sp.tab === 'string' ? sp.tab : undefined
  if (tab === 'list' || tab === 'overview') return tab
  return Object.entries(sp).some(([k, v]) => !NON_LIST_PARAMS.has(k) && v != null && v !== '') ? 'list' : 'overview'
}

export const periodArgs = (cur: Period, prev: Period) => [cur.from, cur.to, prev.from, prev.to]
