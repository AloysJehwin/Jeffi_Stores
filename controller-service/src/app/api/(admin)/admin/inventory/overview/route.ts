import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { istDate } from '@/lib/channels/report-store'
import { buildReorder, num, resolvePeriod, turnoverStats } from './compute'

export const dynamic = 'force-dynamic'

// Sellable leaves (same grains as stock-levels): unit cost = cost price when set, else the
// ex-GST selling price the valuation view uses, flagged has_cost = false.
const LEAVES = `
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

// $1..$4 = cur from/to, prev from/to (IST days); $5 = days in period.
const STOCK_SQL = `${LEAVES}
, bounds AS (
  SELECT ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS cur_start,
         (($2::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS cur_end,
         ($3::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS prev_start,
         (($4::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS prev_end,
         now() - INTERVAL '90 days' AS dead_since
),
sales AS (
  SELECT it.product_id, it.variant_id, it.sub_variant_id,
         COALESCE(SUM(-it.quantity_change) FILTER (WHERE it.created_at >= b.cur_start AND it.created_at < b.cur_end), 0) AS sold_cur,
         COALESCE(SUM(-it.quantity_change) FILTER (WHERE it.created_at >= b.prev_start AND it.created_at < b.prev_end), 0) AS sold_prev,
         MAX(it.created_at) FILTER (WHERE it.transaction_type = 'sale') AS last_sale
  FROM inventory_transactions it CROSS JOIN bounds b
  WHERE it.transaction_type IN ('sale', 'return') AND it.created_at >= LEAST(b.prev_start, b.dead_since)
  GROUP BY 1, 2, 3
),
j AS (
  SELECT p.*, GREATEST(p.qty, 0) AS onhand, GREATEST(p.qty, 0) * p.unit_cost AS value_cost,
         COALESCE(s.sold_cur, 0) AS sold_cur, COALESCE(s.sold_prev, 0) AS sold_prev, s.last_sale
  FROM priced p
  LEFT JOIN sales s ON s.product_id = p.product_id
    AND s.variant_id IS NOT DISTINCT FROM p.variant_id
    AND s.sub_variant_id IS NOT DISTINCT FROM p.sub_variant_id
)
SELECT
  (SELECT json_build_object(
     'skus', COUNT(*),
     'in_stock', COUNT(*) FILTER (WHERE qty > 0),
     'low', COUNT(*) FILTER (WHERE qty > 0 AND threshold IS NOT NULL AND qty <= threshold),
     'out', COUNT(*) FILTER (WHERE qty <= 0),
     'negative', COUNT(*) FILTER (WHERE qty < 0),
     'units', COALESCE(SUM(onhand), 0),
     'value_cost', COALESCE(SUM(value_cost), 0),
     'value_retail', COALESCE(SUM(onhand * price), 0),
     'value_estimated', COALESCE(SUM(value_cost) FILTER (WHERE NOT has_cost), 0),
     'no_cost', COUNT(*) FILTER (WHERE qty > 0 AND NOT has_cost),
     'units_sold', COALESCE(SUM(sold_cur), 0),
     'units_sold_prev', COALESCE(SUM(sold_prev), 0),
     'cogs', COALESCE(SUM(sold_cur * unit_cost), 0),
     'cogs_prev', COALESCE(SUM(sold_prev * unit_cost), 0),
     'dead_count', COUNT(*) FILTER (WHERE qty > 0 AND created_at < (SELECT dead_since FROM bounds) AND (last_sale IS NULL OR last_sale < (SELECT dead_since FROM bounds))),
     'dead_value', COALESCE(SUM(value_cost) FILTER (WHERE qty > 0 AND created_at < (SELECT dead_since FROM bounds) AND (last_sale IS NULL OR last_sale < (SELECT dead_since FROM bounds))), 0)
   ) FROM j) AS totals,
  (SELECT COALESCE(json_agg(t ORDER BY t.value DESC), '[]') FROM (
     SELECT COALESCE(c.name, 'Uncategorized') AS label, SUM(j.value_cost) AS value
     FROM j LEFT JOIN categories c ON c.id = j.category_id
     WHERE j.value_cost > 0 GROUP BY 1) t) AS by_category,
  (SELECT COALESCE(json_agg(t), '[]') FROM (
     SELECT product_id, variant_id, sub_variant_id, name, leaf_name, sku, onhand AS qty, unit_cost, value_cost AS value, has_cost
     FROM j WHERE value_cost > 0 ORDER BY value_cost DESC LIMIT 8) t) AS top_skus,
  (SELECT COALESCE(json_agg(t), '[]') FROM (
     SELECT j.product_id, j.variant_id, j.sub_variant_id, j.name, j.leaf_name, j.sku, j.qty, j.sold_cur AS sold,
            j.unit_cost, ps.lead_time_days, ps.moq, ps.purchase_unit_factor, COALESCE(ps.supplier_id, j.supplier_id) AS supplier_id, su.name AS supplier_name
     FROM j
     LEFT JOIN LATERAL (
       SELECT ps.supplier_id, ps.lead_time_days, ps.moq, ps.purchase_unit_factor FROM product_suppliers ps
       WHERE ps.product_id = j.product_id AND ps.is_active = TRUE
         AND ps.variant_id IS NOT DISTINCT FROM (CASE WHEN j.sub_variant_id IS NULL THEN j.variant_id END)
         AND ps.sub_variant_id IS NOT DISTINCT FROM j.sub_variant_id
       ORDER BY ps.is_preferred DESC, ps.effective_date DESC LIMIT 1
     ) ps ON TRUE
     LEFT JOIN suppliers su ON su.id = COALESCE(ps.supplier_id, j.supplier_id)
     WHERE j.sold_cur > 0 AND j.qty * $5::numeric < j.sold_cur * 90
     ORDER BY GREATEST(j.qty, 0) / j.sold_cur ASC LIMIT 200) t) AS reorder,
  (SELECT COALESCE(json_agg(t), '[]') FROM (
     SELECT product_id, variant_id, sub_variant_id, name, leaf_name, sku, qty, sold_cur AS sold
     FROM j WHERE qty <= 0 AND sold_cur > 0 ORDER BY sold_cur DESC LIMIT 20) t) AS selling_out,
  (SELECT COALESCE(json_agg(t), '[]') FROM (
     SELECT product_id, variant_id, sub_variant_id, name, leaf_name, sku, qty
     FROM j WHERE qty < 0 ORDER BY qty ASC LIMIT 20) t) AS negative,
  (SELECT COALESCE(json_agg(t), '[]') FROM (
     SELECT product_id, variant_id, sub_variant_id, name, leaf_name, sku, qty, value_cost AS value
     FROM j WHERE qty > 0 AND NOT has_cost ORDER BY value_cost DESC LIMIT 20) t) AS no_cost,
  (SELECT COALESCE(json_agg(t), '[]') FROM (
     SELECT product_id, variant_id, sub_variant_id, name, leaf_name, sku, qty, value_cost AS value, last_sale
     FROM j WHERE qty > 0 AND created_at < (SELECT dead_since FROM bounds)
       AND (last_sale IS NULL OR last_sale < (SELECT dead_since FROM bounds))
     ORDER BY value_cost DESC LIMIT 20) t) AS dead
`

// $1..$4 = cur from/to, prev from/to.
const MOVEMENT_SQL = `
WITH b AS (
  SELECT ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS cur_start,
         (($2::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS cur_end,
         ($3::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS prev_start,
         (($4::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS prev_end
),
m AS (
  SELECT it.quantity_change AS q, it.transaction_type AS t,
         (it.created_at AT TIME ZONE 'Asia/Kolkata')::date AS d,
         it.created_at >= b.cur_start AS cur
  FROM inventory_transactions it CROSS JOIN b
  WHERE it.created_at >= b.prev_start AND it.created_at < b.cur_end
    AND (it.created_at >= b.cur_start OR it.created_at < b.prev_end)
)
SELECT
  (SELECT json_build_object(
     'in', COALESCE(SUM(q) FILTER (WHERE cur AND q > 0), 0),
     'out', COALESCE(-SUM(q) FILTER (WHERE cur AND q < 0), 0),
     'in_prev', COALESCE(SUM(q) FILTER (WHERE NOT cur AND q > 0), 0),
     'out_prev', COALESCE(-SUM(q) FILTER (WHERE NOT cur AND q < 0), 0),
     'events', COUNT(*) FILTER (WHERE cur),
     'events_prev', COUNT(*) FILTER (WHERE NOT cur)) FROM m) AS totals,
  (SELECT COALESCE(json_agg(t ORDER BY t.type), '[]') FROM (
     SELECT t AS type, SUM(q) FILTER (WHERE q > 0) AS qty_in, -SUM(q) FILTER (WHERE q < 0) AS qty_out, COUNT(*) AS rows
     FROM m WHERE cur GROUP BY t) t) AS by_type,
  (SELECT COALESCE(json_agg(t ORDER BY t.day), '[]') FROM (
     SELECT g.day::date::text AS day,
            COALESCE(SUM(m.q) FILTER (WHERE m.q > 0), 0) AS qty_in,
            COALESCE(-SUM(m.q) FILTER (WHERE m.q < 0), 0) AS qty_out
     FROM generate_series($1::date, $2::date, INTERVAL '1 day') g(day)
     LEFT JOIN m ON m.cur AND m.d = g.day::date
     GROUP BY g.day) t) AS daily
`

// $1..$4 = cur from/to, prev from/to; $5 = today (IST).
const PO_SQL = `
WITH b AS (SELECT $1::date AS cur_from, $2::date AS cur_to, $3::date AS prev_from, $4::date AS prev_to, $5::date AS today)
SELECT
  (SELECT json_build_object(
     'open_count', COUNT(*) FILTER (WHERE po.status IN ('draft','sent','partial')),
     'open_value', COALESCE(SUM(po.total_amount) FILTER (WHERE po.status IN ('draft','sent','partial')), 0),
     'draft_count', COUNT(*) FILTER (WHERE po.status = 'draft'),
     'overdue_count', COUNT(*) FILTER (WHERE po.status IN ('sent','partial') AND po.expected_date < b.today),
     'overdue_value', COALESCE(SUM(po.total_amount) FILTER (WHERE po.status IN ('sent','partial') AND po.expected_date < b.today), 0),
     'ordered_value', COALESCE(SUM(po.total_amount) FILTER (WHERE po.status <> 'cancelled' AND po.order_date BETWEEN b.cur_from AND b.cur_to), 0),
     'ordered_value_prev', COALESCE(SUM(po.total_amount) FILTER (WHERE po.status <> 'cancelled' AND po.order_date BETWEEN b.prev_from AND b.prev_to), 0),
     'ordered_count', COUNT(*) FILTER (WHERE po.status <> 'cancelled' AND po.order_date BETWEEN b.cur_from AND b.cur_to),
     'ordered_count_prev', COUNT(*) FILTER (WHERE po.status <> 'cancelled' AND po.order_date BETWEEN b.prev_from AND b.prev_to)
   ) FROM purchase_orders po CROSS JOIN b) AS totals,
  (SELECT COALESCE(json_agg(t), '[]') FROM (
     SELECT po.id, po.po_number, po.status, po.expected_date::text AS expected_date, po.total_amount,
            (b.today - po.expected_date) AS days_late, s.name AS supplier_name
     FROM purchase_orders po CROSS JOIN b LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.status IN ('sent','partial') AND po.expected_date < b.today
     ORDER BY po.expected_date ASC LIMIT 20) t) AS overdue,
  (SELECT COALESCE(json_agg(t ORDER BY t.month), '[]') FROM (
     SELECT to_char(date_trunc('month', po.order_date), 'YYYY-MM') AS month, SUM(po.total_amount) AS value
     FROM purchase_orders po CROSS JOIN b
     WHERE po.status <> 'cancelled' AND po.order_date > b.today - INTERVAL '12 months'
     GROUP BY 1) t) AS trend,
  (SELECT COUNT(*) FROM suppliers WHERE is_active = TRUE) AS active_suppliers
`

// $1 = today (IST).
const MISC_SQL = `
SELECT
  (SELECT COALESCE(json_agg(t), '[]') FROM (
     SELECT pb.id, pb.product_id, pb.variant_id, pb.sub_variant_id, p.name, pv.variant_name AS leaf_name,
            pb.lot_number, pb.expiry_date::text AS expiry_date, pb.quantity_remaining AS qty,
            (pb.expiry_date - $1::date) AS days_left,
            pb.quantity_remaining * COALESCE(NULLIF(pv.cost_price, 0), NULLIF(p.cost_price, 0),
              ROUND(COALESCE(pv.price, p.base_price, 0) / (1 + COALESCE(p.gst_percentage, 0) / 100), 2)) AS value
     FROM product_batches pb
     JOIN products p ON p.id = pb.product_id
     LEFT JOIN product_variants pv ON pv.id = pb.variant_id
     WHERE pb.quantity_remaining > 0 AND pb.expiry_date IS NOT NULL AND pb.expiry_date <= $1::date + 30
     ORDER BY pb.expiry_date ASC LIMIT 20) t) AS expiring,
  (SELECT COALESCE(json_agg(t ORDER BY t.created_at DESC), '[]') FROM (
     SELECT MAX(it.created_at) AS created_at, it.transaction_type, SUM(it.quantity_change) AS quantity_change,
            COUNT(*) AS rows, it.reference_type, MIN(it.unit_label) AS unit_label,
            it.product_id, p.name, MIN(COALESCE(pv.variant_name || COALESCE(' / ' || sv.sub_variant_name, ''), '')) AS leaf_name,
            MIN(CASE WHEN it.reference_type = 'order' THEN o.invoice_number
                     WHEN it.reference_type = 'cash_sale' THEN cs.invoice_number
                     WHEN it.reference_type = 'grn' THEN g.grn_number END) AS reference_label,
            concat_ws(':', COALESCE(it.reference_id::text, MIN(it.id::text)), it.transaction_type, it.product_id, it.variant_id, it.sub_variant_id) AS key
     FROM inventory_transactions it
     JOIN products p ON p.id = it.product_id
     LEFT JOIN product_variants pv ON pv.id = it.variant_id
     LEFT JOIN product_sub_variants sv ON sv.id = it.sub_variant_id
     LEFT JOIN orders o ON it.reference_type = 'order' AND o.id = it.reference_id
     LEFT JOIN cash_sales cs ON it.reference_type = 'cash_sale' AND cs.id = it.reference_id
     LEFT JOIN grns g ON it.reference_type = 'grn' AND g.id = it.reference_id
     WHERE it.created_at > (SELECT MAX(created_at) FROM inventory_transactions) - INTERVAL '120 days'
     GROUP BY it.reference_id, it.reference_type, it.transaction_type, it.product_id, it.variant_id, it.sub_variant_id, p.name,
              CASE WHEN it.reference_id IS NULL THEN it.id END
     ORDER BY MAX(it.created_at) DESC LIMIT 10) t) AS recent
`

type Json = Record<string, any>
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v : [])

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'inventory:read')
  if (admin instanceof NextResponse) return admin
  try {
    const sp = request.nextUrl.searchParams
    const today = istDate()
    const period = resolvePeriod(sp.get('from'), sp.get('to'), today)
    const range = [period.from, period.to, period.prevFrom, period.prevTo]

    const [stock, mov, po, misc] = await Promise.all([
      queryOne<Json>(STOCK_SQL, [...range, period.days]),
      queryOne<Json>(MOVEMENT_SQL, range),
      queryOne<Json>(PO_SQL, [...range, today]),
      queryOne<Json>(MISC_SQL, [today]),
    ])

    const t = stock?.totals ?? {}
    const stockValue = num(t.value_cost)
    const cogs = num(t.cogs)
    const cogsPrev = num(t.cogs_prev)
    const turn = turnoverStats(cogs, stockValue, period.days)
    const turnPrev = turnoverStats(cogsPrev, stockValue, period.days)

    return NextResponse.json({
      period: { ...period, today },
      stock: {
        skus: num(t.skus),
        inStock: num(t.in_stock),
        low: num(t.low),
        out: num(t.out),
        negative: num(t.negative),
        units: num(t.units),
        valueCost: stockValue,
        valueRetail: num(t.value_retail),
        valueEstimated: num(t.value_estimated),
        noCost: num(t.no_cost),
        deadCount: num(t.dead_count),
        deadValue: num(t.dead_value),
      },
      sales: {
        units: num(t.units_sold),
        unitsPrev: num(t.units_sold_prev),
        cogs,
        cogsPrev,
        turnover: turn.turnover,
        turnoverPrev: turnPrev.turnover,
        annualTurnover: turn.annualTurnover,
        daysOfCover: turn.daysOfCover,
      },
      movements: {
        in: num(mov?.totals?.in),
        out: num(mov?.totals?.out),
        inPrev: num(mov?.totals?.in_prev),
        outPrev: num(mov?.totals?.out_prev),
        events: num(mov?.totals?.events),
        eventsPrev: num(mov?.totals?.events_prev),
        byType: arr(mov?.by_type).map(r => ({
          type: r.type,
          in: num(r.qty_in),
          out: num(r.qty_out),
          rows: num(r.rows),
        })),
        daily: arr(mov?.daily).map(r => ({ day: r.day, in: num(r.qty_in), out: num(r.qty_out) })),
      },
      po: {
        openCount: num(po?.totals?.open_count),
        openValue: num(po?.totals?.open_value),
        draftCount: num(po?.totals?.draft_count),
        overdueCount: num(po?.totals?.overdue_count),
        overdueValue: num(po?.totals?.overdue_value),
        orderedValue: num(po?.totals?.ordered_value),
        orderedValuePrev: num(po?.totals?.ordered_value_prev),
        orderedCount: num(po?.totals?.ordered_count),
        orderedCountPrev: num(po?.totals?.ordered_count_prev),
        activeSuppliers: num(po?.active_suppliers),
        overdue: arr(po?.overdue).map(r => ({ ...r, total_amount: num(r.total_amount), days_late: num(r.days_late) })),
        trend: arr(po?.trend).map(r => ({ month: r.month, value: num(r.value) })),
      },
      byCategory: arr(stock?.by_category).map(r => ({ label: r.label, value: num(r.value) })),
      topSkus: arr(stock?.top_skus).map(r => ({
        ...r,
        qty: num(r.qty),
        unit_cost: num(r.unit_cost),
        value: num(r.value),
      })),
      reorder: buildReorder(
        arr(stock?.reorder).map(r => ({ ...r, qty: num(r.qty), sold: num(r.sold), unit_cost: num(r.unit_cost) })),
        period.days
      ),
      sellingOut: arr(stock?.selling_out).map(r => ({ ...r, qty: num(r.qty), sold: num(r.sold) })),
      negative: arr(stock?.negative).map(r => ({ ...r, qty: num(r.qty) })),
      noCost: arr(stock?.no_cost).map(r => ({ ...r, qty: num(r.qty), value: num(r.value) })),
      dead: arr(stock?.dead).map(r => ({ ...r, qty: num(r.qty), value: num(r.value) })),
      expiring: arr(misc?.expiring).map(r => ({
        ...r,
        qty: num(r.qty),
        value: num(r.value),
        days_left: num(r.days_left),
      })),
      recent: arr(misc?.recent).map(r => ({ ...r, quantity_change: num(r.quantity_change), rows: num(r.rows) })),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
