import type { AttentionItem } from '@/lib/overview/attention'
import { PRODUCT_IN_STOCK_SQL } from '@/lib/queries/shared'
import { NO_SCOPE, type BoundScope } from '@/lib/overview/filter-scope'
import { inIst, istDay, num, soldLines } from './catalog'

// Products overview: catalogue health (now), sales/views/price changes (period vs previous).
// Params everywhere: $1/$2 current IST days, $3/$4 previous. `f` carries the products list's
// filters: `f.and` on the alias p, `f.ids(col)` on a product id column.

export const HEALTH_ISSUES = [
  'no_price',
  'no_image',
  'no_hsn',
  'no_gst',
  'no_cost',
  'no_description',
  'out_of_stock',
] as const
export type HealthIssue = (typeof HEALTH_ISSUES)[number]

export const ISSUE_LABEL: Record<HealthIssue, string> = {
  no_price: 'No price',
  no_image: 'No image',
  no_hsn: 'No HSN code',
  no_gst: 'No GST rate',
  no_cost: 'No cost price',
  no_description: 'No description',
  out_of_stock: 'Out of stock',
}

// One row per non-draft product with its health flags and a period score (sales + views) to rank samples.
const flags = (f: BoundScope) => `
  flags AS (
    SELECT p.id, p.name, p.is_active, p.created_at,
      (NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id) AND NULLIF(btrim(COALESCE(p.image_url, '')), '') IS NULL) AS no_image,
      (NULLIF(btrim(COALESCE(p.description, '')), '') IS NULL) AS no_description,
      (NULLIF(btrim(COALESCE(p.hsn_code, '')), '') IS NULL) AS no_hsn,
      (p.gst_percentage IS NULL) AS no_gst,
      (CASE WHEN p.has_variants
        THEN EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active
                     AND COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0)) IS NULL)
        ELSE COALESCE(p.cost_price, 0) = 0 END) AS no_cost,
      (CASE WHEN p.has_variants
        THEN NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active)
          OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active
                     AND COALESCE(pv.price, p.base_price, 0) <= 0)
          OR EXISTS (SELECT 1 FROM product_sub_variants sv JOIN product_variants pv ON pv.id = sv.variant_id
                     WHERE sv.product_id = p.id AND sv.is_active AND pv.is_active
                     AND COALESCE(sv.price, pv.price, p.base_price, 0) <= 0)
        ELSE COALESCE(p.base_price, 0) <= 0 END) AS no_price,
      (NOT ${PRODUCT_IN_STOCK_SQL}) AS out_of_stock
    FROM products p
    WHERE NOT p.is_draft${f.and}
  )`
const sold = (f: BoundScope) => soldLines(f.ids('oi.product_id'))

export const healthSql = (f = NO_SCOPE) => `
  WITH ${flags(f)}
  SELECT COUNT(*) AS total,
         COUNT(*) FILTER (WHERE is_active) AS active,
         COUNT(*) FILTER (WHERE NOT is_active) AS inactive,
         (SELECT COUNT(*) FROM products WHERE is_draft) AS drafts,
         COUNT(*) FILTER (WHERE is_active AND no_price) AS no_price,
         COUNT(*) FILTER (WHERE is_active AND no_image) AS no_image,
         COUNT(*) FILTER (WHERE is_active AND no_hsn) AS no_hsn,
         COUNT(*) FILTER (WHERE is_active AND no_gst) AS no_gst,
         COUNT(*) FILTER (WHERE is_active AND no_cost) AS no_cost,
         COUNT(*) FILTER (WHERE is_active AND no_description) AS no_description,
         COUNT(*) FILTER (WHERE is_active AND out_of_stock) AS out_of_stock,
         COUNT(*) FILTER (WHERE is_active AND NOT (no_price OR no_image OR no_hsn OR no_gst OR no_cost OR no_description)) AS complete
  FROM flags`
export const HEALTH_SQL = healthSql()

// Up to 5 active products per issue, the ones that matter most (period sales, then views) first.
export const healthSamplesSql = (f = NO_SCOPE) => `
  WITH ${flags(f)},
  score AS (
    SELECT f.*,
      COALESCE((SELECT SUM(oi.total_price) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = f.id AND o.payment_status = 'paid'
                  AND ${inIst('COALESCE(o.invoice_date, o.created_at)', 1, 2)}), 0) AS sales,
      (SELECT COUNT(*) FROM product_views v WHERE v.product_id = f.id AND ${inIst('v.created_at', 1, 2)}) AS views
    FROM flags f WHERE f.is_active
      AND (f.no_price OR f.no_image OR f.no_hsn OR f.no_gst OR f.no_cost OR f.no_description OR f.out_of_stock)
  )
  SELECT issue, id, name, sales, views FROM (
    SELECT x.issue, s.id, s.name, s.sales, s.views,
           row_number() OVER (PARTITION BY x.issue ORDER BY s.sales DESC, s.views DESC, s.name) AS rn
    FROM score s
    CROSS JOIN LATERAL (VALUES ('no_price', s.no_price), ('no_image', s.no_image), ('no_hsn', s.no_hsn),
      ('no_gst', s.no_gst), ('no_cost', s.no_cost), ('no_description', s.no_description),
      ('out_of_stock', s.out_of_stock)) x(issue, hit)
    WHERE x.hit
  ) r WHERE rn <= 5
  ORDER BY issue, rn`
export const HEALTH_SAMPLES_SQL = healthSamplesSql()

// Active products that sold in either period but are out of stock now.
export const sellersOutSql = (f = NO_SCOPE) => `
  WITH ${sold(f)}
  SELECT p.id, p.name, SUM(s.quantity) FILTER (WHERE s.cur) AS units_cur, SUM(s.value) AS value
  FROM sold s JOIN products p ON p.id = s.product_id
  WHERE p.is_active AND NOT p.is_draft AND NOT ${PRODUCT_IN_STOCK_SQL}
  GROUP BY p.id ORDER BY value DESC LIMIT 10`
export const SELLERS_OUT_SQL = sellersOutSql()

const PC_PRODUCT = `CASE WHEN a.entity_type = 'products' THEN a.entity_id ELSE a.metadata->>'product_id' END`
const priceChanges = (f: BoundScope) => `
  pc AS (
    SELECT a.id, a.created_at, a.entity_type, a.entity_id,
           CASE WHEN a.entity_type = 'products' THEN a.entity_id ELSE a.metadata->>'product_id' END AS product_id,
           CASE WHEN a.entity_type = 'products' THEN a.diff->'base_price' ELSE a.diff->'price' END AS ch,
           a.metadata ? 'inflation_id' AS bulk,
           (${inIst('a.created_at', 1, 2)}) AS cur
    FROM admin_audit_log a
    WHERE a.action = 'update'
      AND ((a.entity_type = 'products' AND a.diff ? 'base_price')
        OR (a.entity_type IN ('product_variants', 'product_sub_variants') AND a.diff ? 'price'))
      -- base_price on a product with variants is not what shoppers pay
      AND (a.entity_type <> 'products' OR NOT EXISTS (SELECT 1 FROM products px WHERE px.id = (CASE WHEN a.entity_type = 'products' THEN a.entity_id END)::uuid AND px.has_variants))
      AND (${inIst('a.created_at', 1, 2)} OR ${inIst('a.created_at', 3, 4)})${
        f.ids('px2.id')
          ? `\n      AND EXISTS (SELECT 1 FROM products px2 WHERE px2.id::text = (${PC_PRODUCT})${f.ids('px2.id')})`
          : ''
      }
  )`

export const periodSql = (f = NO_SCOPE) => `
  WITH ${sold(f)}, ${priceChanges(f)},
  per AS (SELECT unnest(ARRAY[true, false]) AS cur)
  SELECT per.cur,
    (SELECT COALESCE(SUM(quantity), 0) FROM sold WHERE sold.cur = per.cur) AS units,
    (SELECT COALESCE(SUM(value), 0) FROM sold WHERE sold.cur = per.cur) AS sales,
    (SELECT COUNT(DISTINCT order_id) FROM sold WHERE sold.cur = per.cur) AS orders,
    (SELECT COUNT(DISTINCT product_id) FROM sold WHERE sold.cur = per.cur) AS products_sold,
    (SELECT COALESCE(SUM(net), 0) FROM sold WHERE sold.cur = per.cur AND cost IS NOT NULL) AS costed_net,
    (SELECT COALESCE(SUM(cost), 0) FROM sold WHERE sold.cur = per.cur) AS cost,
    (SELECT COUNT(*) FROM product_views v WHERE CASE WHEN per.cur THEN ${inIst('v.created_at', 1, 2)} ELSE ${inIst('v.created_at', 3, 4)} END${f.ids('v.product_id')}) AS views,
    (SELECT COUNT(*) FROM products p WHERE NOT p.is_draft AND CASE WHEN per.cur THEN ${inIst('p.created_at', 1, 2)} ELSE ${inIst('p.created_at', 3, 4)} END${f.and}) AS added,
    (SELECT COUNT(*) FROM pc WHERE pc.cur = per.cur) AS price_changes,
    (SELECT COUNT(DISTINCT product_id) FROM pc WHERE pc.cur = per.cur) AS products_repriced
  FROM per`
export const PERIOD_SQL = periodSql()

/** $5 = bucket ('day' | 'week' | 'month'). */
export const seriesSql = (f = NO_SCOPE) => `
  WITH ${sold(f)},
  b AS (SELECT generate_series(date_trunc($5, $1::date), date_trunc($5, $2::date), ('1 ' || $5)::interval)::date AS bucket),
  s AS (SELECT date_trunc($5, d)::date AS bucket, SUM(value) AS sales, SUM(quantity) AS units FROM sold WHERE cur GROUP BY 1),
  v AS (SELECT date_trunc($5, ${istDay('created_at')})::date AS bucket, COUNT(*) AS views
        FROM product_views WHERE ${inIst('created_at', 1, 2)}${f.ids('product_id')} GROUP BY 1)
  SELECT b.bucket::text AS bucket, COALESCE(s.sales, 0) AS sales, COALESCE(s.units, 0) AS units, COALESCE(v.views, 0) AS views
  FROM b LEFT JOIN s USING (bucket) LEFT JOIN v USING (bucket)
  ORDER BY b.bucket`
export const SERIES_SQL = seriesSql()

export const topSellersSql = (f = NO_SCOPE) => `
  WITH ${sold(f)},
  agg AS (
    SELECT product_id,
           SUM(quantity) FILTER (WHERE cur) AS units, SUM(value) FILTER (WHERE cur) AS sales,
           SUM(value) FILTER (WHERE NOT cur) AS prev_sales,
           SUM(net) FILTER (WHERE cur AND cost IS NOT NULL) AS costed_net, SUM(cost) FILTER (WHERE cur) AS cost
    FROM sold GROUP BY product_id
  )
  SELECT p.id, p.name, a.units, a.sales, a.prev_sales, a.costed_net, a.cost,
         (SELECT COUNT(*) FROM product_views v WHERE v.product_id = p.id AND ${inIst('v.created_at', 1, 2)}) AS views
  FROM agg a JOIN products p ON p.id = a.product_id
  WHERE a.sales > 0
  ORDER BY a.sales DESC LIMIT 10`
export const TOP_SELLERS_SQL = topSellersSql()

export const mostViewedSql = (f = NO_SCOPE) => `
  WITH ${sold(f)},
  v AS (SELECT product_id, COUNT(*) AS views, COUNT(DISTINCT session_id) AS sessions
        FROM product_views WHERE product_id IS NOT NULL AND ${inIst('created_at', 1, 2)}${f.ids('product_id')} GROUP BY product_id)
  SELECT p.id, p.name, v.views, v.sessions,
         COALESCE((SELECT COUNT(DISTINCT order_id) FROM sold WHERE sold.cur AND sold.product_id = p.id), 0) AS orders,
         COALESCE((SELECT SUM(quantity) FROM sold WHERE sold.cur AND sold.product_id = p.id), 0) AS units
  FROM v JOIN products p ON p.id = v.product_id
  ORDER BY v.views DESC LIMIT 10`
export const MOST_VIEWED_SQL = mostViewedSql()

// Active products older than 30 days that have never been on a paid, live order.
const neverSold = (f: BoundScope) => `
  ns AS (
    SELECT p.id, p.name, p.created_at,
           (SELECT COUNT(*) FROM product_views v WHERE v.product_id = p.id AND ${inIst('v.created_at', 1, 2)}) AS views
    FROM products p
    WHERE p.is_active AND NOT p.is_draft AND p.created_at < (($2::date - 30)::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                      WHERE oi.product_id = p.id AND o.payment_status = 'paid'
                        AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected'))${f.and}
  )`

export const neverSoldSql = (f = NO_SCOPE) => `
  WITH ${neverSold(f)}
  SELECT (SELECT COUNT(*) FROM ns) AS total, id, name, created_at, views
  FROM ns ORDER BY views DESC, created_at ASC LIMIT 10`
export const NEVER_SOLD_SQL = neverSoldSql()

export const recentSql = (f = NO_SCOPE) => `
  WITH ${flags(f)}
  SELECT id, name, is_active, created_at, no_price, no_image, no_hsn, no_gst, no_cost, no_description, out_of_stock
  FROM flags WHERE ${inIst('created_at', 1, 2)}
  ORDER BY created_at DESC LIMIT 10`
export const RECENT_SQL = recentSql()

export const priceChangesSql = (f = NO_SCOPE) => `
  WITH ${priceChanges(f)}
  SELECT pc.id, pc.created_at, pc.entity_type, pc.product_id, p.name, pc.ch->>'from' AS from_price, pc.ch->>'to' AS to_price, pc.bulk,
         COALESCE(pv.variant_name, sv.sub_variant_name) AS variant_name
  FROM pc
  LEFT JOIN products p ON p.id::text = pc.product_id
  LEFT JOIN product_variants pv ON pc.entity_type = 'product_variants' AND pv.id::text = pc.entity_id
  LEFT JOIN product_sub_variants sv ON pc.entity_type = 'product_sub_variants' AND sv.id::text = pc.entity_id
  WHERE pc.cur
  ORDER BY pc.created_at DESC LIMIT 10`
export const PRICE_CHANGES_SQL = priceChangesSql()

export const priceChangeStatsSql = (f = NO_SCOPE) => `
  WITH ${priceChanges(f)},
  c AS (SELECT bulk, (ch->>'from')::numeric AS f, (ch->>'to')::numeric AS t FROM pc WHERE cur)
  SELECT COUNT(*) FILTER (WHERE bulk) AS bulk,
         COUNT(*) FILTER (WHERE NOT bulk) AS manual,
         COUNT(*) FILTER (WHERE f > 0 AND t > f) AS increases,
         COUNT(*) FILTER (WHERE f > 0 AND t > 0 AND t < f) AS decreases,
         COUNT(*) FILTER (WHERE COALESCE(t, 0) <= 0 AND COALESCE(f, 0) > 0) AS cleared,
         AVG((t - f) / f) FILTER (WHERE f > 0 AND t > 0) AS avg_change
  FROM c`
export const PRICE_CHANGE_STATS_SQL = priceChangeStatsSql()

export type HealthCounts = Record<'total' | 'active' | 'inactive' | 'drafts' | 'complete' | HealthIssue, number>

export function healthCounts(row: Record<string, unknown> | null | undefined): HealthCounts {
  const keys = ['total', 'active', 'inactive', 'drafts', 'complete', ...HEALTH_ISSUES] as const
  return Object.fromEntries(keys.map(k => [k, num(row?.[k])])) as HealthCounts
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

/** Needs-attention items for the products overview, most severe first. */
export function productAttention(
  h: HealthCounts,
  sellersOut: { id: string; name: string }[],
  neverSold: number
): AttentionItem[] {
  const out: AttentionItem[] = []
  if (sellersOut.length)
    out.push({
      key: 'sellers_out',
      severity: 'critical',
      title: `${plural(sellersOut.length, 'selling product')} out of stock`,
      sub:
        sellersOut
          .slice(0, 3)
          .map(p => p.name)
          .join(', ') + (sellersOut.length > 3 ? ` and ${sellersOut.length - 3} more` : ''),
      href: '/admin/products?tab=list&stock=out',
    })
  if (h.no_price)
    out.push({
      key: 'no_price',
      severity: 'critical',
      title: `${plural(h.no_price, 'active product')} with no price`,
      sub: 'Shoppers cannot buy them',
      href: '/admin/products?tab=overview#health',
    })
  const tax = Math.max(h.no_hsn, h.no_gst)
  if (tax)
    out.push({
      key: 'no_tax',
      severity: 'warning',
      title: `${plural(tax, 'active product')} missing HSN code or GST rate`,
      sub: `${h.no_hsn} without HSN, ${h.no_gst} without GST rate; needed on GST invoices`,
      href: '/admin/products?tab=overview#health',
    })
  if (h.no_image)
    out.push({
      key: 'no_image',
      severity: 'warning',
      title: `${plural(h.no_image, 'active product')} with no image`,
      href: '/admin/products?tab=overview#health',
    })
  if (h.no_cost)
    out.push({
      key: 'no_cost',
      severity: h.active && h.no_cost / h.active > 0.5 ? 'warning' : 'info',
      title: `${plural(h.no_cost, 'active product')} with no cost price`,
      sub: 'Margin cannot be measured for them',
      href: '/admin/products?tab=overview#health',
    })
  if (h.no_description)
    out.push({
      key: 'no_description',
      severity: 'info',
      title: `${plural(h.no_description, 'active product')} with no description`,
      href: '/admin/products?tab=overview#health',
    })
  if (neverSold)
    out.push({
      key: 'never_sold',
      severity: 'info',
      title: `${plural(neverSold, 'product')} listed over 30 days and never sold`,
      href: '/admin/products?tab=overview#never-sold',
    })
  if (h.out_of_stock)
    out.push({
      key: 'out_of_stock',
      severity: 'info',
      title: `${plural(h.out_of_stock, 'active product')} out of stock`,
      href: '/admin/products?tab=list&stock=out',
    })
  return out
}
