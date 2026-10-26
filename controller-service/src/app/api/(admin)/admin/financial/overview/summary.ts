import { queryMany, queryOne } from '@/lib/shared/db'
import {
  AGING_KEYS,
  bucketFor,
  fillSeries,
  previousPeriod,
  type AgingKey,
  type Bucket,
  type Range,
} from '@/app/(admin)/admin/financial/_components/overview-period'
import type { FinanceOverviewContract } from '@/app/(admin)/admin/financial/_components/finance-overview-contract'
import { aiTotals } from '../ai-costs/summary'

// Finance overview in SQL. Revenue, refunds and COGS follow getPLReport; cash in/out follow
// getCashflow; receivables and payables follow getReceivablesAging / getPayables, with failed,
// reversed or cancelled supplier payouts not counted as paid. Days are IST business days.

export const COD_STALE_DAYS = 7

const IST = `'Asia/Kolkata'`
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
/** Timestamp `expr` within IST days [$a, $b]. */
const inIst = (expr: string, a: number, b: number) =>
  `${expr} >= ($${a}::date::timestamp AT TIME ZONE ${IST}) AND ${expr} < (($${b}::date + 1)::timestamp AT TIME ZONE ${IST})`
const istDay = (expr: string) => `(${expr} AT TIME ZONE ${IST})::date`
const LIVE_PAYOUT = `COALESCE(ep.payout_status, '') NOT IN ('failed', 'reversed', 'cancelled')`
const INACTIVE = `('cancelled', 'returned', 'draft', 'cancel_rejected')`

// Paid sales in the period: orders (P&L definition) plus paid cash sales.
const salesCte = (a: number, b: number) => `
  sales AS (
    SELECT o.id, 'order' AS kind, o.total_amount AS amount, ${istDay('COALESCE(o.invoice_date, o.created_at)')} AS d,
      CASE o.source WHEN 'amazon' THEN 'amazon' WHEN 'business' THEN 'b2b' WHEN 'online' THEN 'website' ELSE 'store' END AS channel,
      CASE
        WHEN o.payment_mode = 'cod' THEN 'cod'
        WHEN o.payment_mode = 'marketplace' OR o.source = 'amazon' THEN 'marketplace'
        WHEN o.payment_mode LIKE 'upi%' THEN 'upi'
        WHEN o.payment_mode = 'credit' THEN 'credit'
        WHEN o.source = 'online' THEN 'online'
        ELSE 'cash'
      END AS method
    FROM orders o
    WHERE o.payment_status = 'paid' AND o.status NOT IN ${INACTIVE}
      AND ${inIst('COALESCE(o.invoice_date, o.created_at)', a, b)}
    UNION ALL
    SELECT cs.id, 'cash_sale', cs.total_amount, ${istDay('cs.created_at')}, 'store',
      CASE WHEN cs.payment_mode LIKE 'upi%' THEN 'upi' WHEN cs.payment_mode = 'card' THEN 'card' ELSE 'cash' END
    FROM cash_sales cs
    WHERE cs.payment_status = 'paid' AND ${inIst('cs.created_at', a, b)}
  )`

const cogsJoin = `
  FROM sales s
  JOIN order_items oi ON oi.order_id = s.id AND s.kind = 'order'
  JOIN products p ON p.id = oi.product_id
  LEFT JOIN product_variants pv ON pv.id = oi.variant_id`
const cogsExpr = `oi.quantity * COALESCE(pv.cost_price, p.cost_price, 0)`

export interface PeriodTotals {
  revenue: number
  orders: number
  refunds: number
  net_sales: number
  cogs: number
  gross_profit: number
  gross_margin: number | null
  inflow: number
  supplier_payments: number
  refunds_out: number
  outflow: number
  net_cash: number
  refunds_issued: number
  refunds_issued_count: number
  gst_output: number | null
  gst_itc: number | null
  gst_payable: number | null
}

const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)

export async function periodTotals(r: Range, withGst: boolean): Promise<PeriodTotals> {
  const row = await queryOne<Record<string, string | number | null>>(
    `WITH ${salesCte(1, 2)}
     SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM sales) AS revenue,
       (SELECT COUNT(*) FROM sales) AS orders,
       (SELECT COALESCE(SUM(${cogsExpr}), 0) ${cogsJoin}) AS cogs,
       (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o
         WHERE o.status IN ('cancelled', 'returned') AND o.payment_status = 'paid'
           AND ${inIst('COALESCE(o.invoice_date, o.created_at)', 1, 2)}) AS refunds,
       (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o
         WHERE o.status IN ('cancelled', 'returned') AND o.payment_status = 'paid'
           AND ${inIst('o.updated_at', 1, 2)}) AS refunds_out,
       (SELECT COALESCE(SUM(ep.amount), 0) FROM expense_payments ep
         WHERE ep.payment_date BETWEEN $1::date AND $2::date AND ${LIVE_PAYOUT}) AS supplier_payments,
       (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o
         WHERE o.payment_status = 'refunded' AND ${inIst('o.updated_at', 1, 2)}) AS refunds_issued,
       (SELECT COUNT(*) FROM orders o
         WHERE o.payment_status = 'refunded' AND ${inIst('o.updated_at', 1, 2)}) AS refunds_issued_count,
       CASE WHEN $3::boolean THEN (SELECT COALESCE(SUM(o.cgst_amount + o.sgst_amount + o.igst_amount), 0) FROM orders o
         WHERE o.invoice_number IS NOT NULL AND o.payment_status = 'paid'
           AND ${inIst('o.invoice_date', 1, 2)}) END AS gst_output,
       CASE WHEN $3::boolean THEN (SELECT COALESCE(SUM(ROUND(poi.quantity * poi.unit_cost * COALESCE(poi.tax_rate, 0) / 100, 2)), 0)
         FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
         WHERE po.status IN ('received', 'partial') AND po.order_date BETWEEN $1::date AND $2::date) END AS gst_itc`,
    [r.from, r.to, withGst]
  )
  const revenue = n(row?.revenue)
  const refunds = n(row?.refunds)
  const netSales = revenue - refunds
  const cogs = n(row?.cogs)
  const supplier = n(row?.supplier_payments)
  const refundsOut = n(row?.refunds_out)
  const outflow = supplier + refundsOut
  const gstOut = withGst ? n(row?.gst_output) : null
  const itc = withGst ? n(row?.gst_itc) : null
  return {
    revenue,
    orders: n(row?.orders),
    refunds,
    net_sales: netSales,
    cogs,
    gross_profit: netSales - cogs,
    gross_margin: cogs > 0 && netSales > 0 ? (netSales - cogs) / netSales : null,
    inflow: revenue,
    supplier_payments: supplier,
    refunds_out: refundsOut,
    outflow,
    net_cash: revenue - outflow,
    refunds_issued: n(row?.refunds_issued),
    refunds_issued_count: n(row?.refunds_issued_count),
    gst_output: gstOut,
    gst_itc: itc,
    gst_payable: gstOut == null || itc == null ? null : gstOut - itc,
  }
}

export const SERIES_KEYS = ['revenue', 'cogs', 'supplier_payments', 'refunds_out'] as const

async function series(r: Range, b: Bucket) {
  const rows = await queryMany<{ b: string; k: string; v: string }>(
    `WITH ${salesCte(1, 2)}
     SELECT date_trunc($3::text, d)::date::text AS b, 'revenue' AS k, SUM(amount) AS v FROM sales GROUP BY 1
     UNION ALL
     SELECT date_trunc($3::text, s.d)::date::text, 'cogs', SUM(${cogsExpr}) ${cogsJoin} GROUP BY 1
     UNION ALL
     SELECT date_trunc($3::text, ep.payment_date)::date::text, 'supplier_payments', SUM(ep.amount)
       FROM expense_payments ep WHERE ep.payment_date BETWEEN $1::date AND $2::date AND ${LIVE_PAYOUT} GROUP BY 1
     UNION ALL
     SELECT date_trunc($3::text, ${istDay('o.updated_at')})::date::text, 'refunds_out', SUM(o.total_amount)
       FROM orders o WHERE o.status IN ('cancelled', 'returned') AND o.payment_status = 'paid'
         AND ${inIst('o.updated_at', 1, 2)} GROUP BY 1`,
    [r.from, r.to, b]
  )
  return fillSeries(r, b, SERIES_KEYS, rows).map(p => ({
    ...p,
    cash_in: p.revenue,
    cash_out: p.supplier_payments + p.refunds_out,
    net: p.revenue - p.supplier_payments - p.refunds_out,
  }))
}

async function breakdown(r: Range) {
  return queryMany<{ channel: string; method: string; amount: string; n: string }>(
    `WITH ${salesCte(1, 2)}
     SELECT channel, method, SUM(amount) AS amount, COUNT(*) AS n FROM sales GROUP BY 1, 2`,
    [r.from, r.to]
  )
}

function group(rows: { channel: string; method: string; amount: string; n: string }[], key: 'channel' | 'method') {
  const m = new Map<string, { key: string; amount: number; count: number }>()
  for (const row of rows) {
    const k = row[key]
    const e = m.get(k) ?? { key: k, amount: 0, count: 0 }
    e.amount += n(row.amount)
    e.count += n(row.n)
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount)
}

const agingCase = (days: string) => `CASE
  WHEN ${days} <= 0 THEN 'current' WHEN ${days} <= 30 THEN 'd1_30' WHEN ${days} <= 60 THEN 'd31_60'
  WHEN ${days} <= 90 THEN 'd61_90' ELSE 'd90_plus' END`

// Receivables age from the invoice date (no credit terms are stored).
const RECEIVABLES = `
  SELECT o.id, o.order_number, COALESCE(NULLIF(o.customer_name, ''), 'Customer') AS customer_name, o.total_amount AS amount,
    (${TODAY} - ${istDay('COALESCE(o.invoice_date, o.created_at)')})::int AS days
  FROM orders o
  WHERE o.payment_status IN ('unpaid', 'partial') AND o.status NOT IN ${INACTIVE}`

// Open supplier bills; days past the due date (no due date counts as current).
const PAYABLES = `
  SELECT e.id, e.expense_number, e.supplier_name, e.due_date::text AS due_date,
    e.total_amount - COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id AND ${LIVE_PAYOUT}), 0) AS amount,
    COALESCE(${TODAY} - e.due_date, 0)::int AS days
  FROM expenses e WHERE e.status != 'paid'`

type AgingRow = { bucket: AgingKey; amount: string; n: string }
function aging(rows: AgingRow[]) {
  return AGING_KEYS.map(({ key, label }) => {
    const r = rows.find(x => x.bucket === key)
    return { key, label, amount: n(r?.amount), count: n(r?.n) }
  })
}

async function snapshot() {
  const [recAging, payAging, payDue, cod, topSuppliers] = await Promise.all([
    queryMany<AgingRow>(
      `SELECT ${agingCase('days')} AS bucket, SUM(amount) AS amount, COUNT(*) AS n FROM (${RECEIVABLES}) x GROUP BY 1`
    ),
    queryMany<AgingRow>(
      `SELECT ${agingCase('days')} AS bucket, SUM(amount) AS amount, COUNT(*) AS n FROM (${PAYABLES}) x WHERE amount > 0 GROUP BY 1`
    ),
    queryOne<{ due7: string; due7_n: string; overdue: string; overdue_n: string }>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE due_date::date BETWEEN ${TODAY} AND ${TODAY} + 7), 0) AS due7,
         COUNT(*) FILTER (WHERE due_date::date BETWEEN ${TODAY} AND ${TODAY} + 7) AS due7_n,
         COALESCE(SUM(amount) FILTER (WHERE due_date::date < ${TODAY}), 0) AS overdue,
         COUNT(*) FILTER (WHERE due_date::date < ${TODAY}) AS overdue_n
       FROM (${PAYABLES}) x WHERE amount > 0`
    ),
    queryOne<{ collected: string; collected_n: string; pending: string; pending_n: string }>(
      `SELECT
         COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'cod_collected'), 0) AS collected,
         COUNT(*) FILTER (WHERE payment_status = 'cod_collected') AS collected_n,
         COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'cod_pending'), 0) AS pending,
         COUNT(*) FILTER (WHERE payment_status = 'cod_pending') AS pending_n
       FROM orders WHERE payment_mode = 'cod' AND status NOT IN ${INACTIVE}`
    ),
    queryMany<{ name: string; amount: number; n: number }>(
      `SELECT supplier_name AS name, SUM(amount)::float8 AS amount, COUNT(*)::int AS n FROM (${PAYABLES}) x
       WHERE amount > 0 GROUP BY 1 ORDER BY 2 DESC LIMIT 6`
    ),
  ])
  const rec = aging(recAging)
  const pay = aging(payAging)
  return {
    receivables: { total: rec.reduce((s, b) => s + b.amount, 0), count: rec.reduce((s, b) => s + b.count, 0), aging: rec },
    payables: {
      total: pay.reduce((s, b) => s + b.amount, 0),
      count: pay.reduce((s, b) => s + b.count, 0),
      due_7d: n(payDue?.due7),
      due_7d_count: n(payDue?.due7_n),
      overdue: n(payDue?.overdue),
      overdue_count: n(payDue?.overdue_n),
      aging: pay,
      top_suppliers: topSuppliers,
    },
    cod: {
      awaiting_remittance: n(cod?.collected),
      awaiting_remittance_count: n(cod?.collected_n),
      in_transit: n(cod?.pending),
      in_transit_count: n(cod?.pending_n),
    },
  }
}

async function attention() {
  const [receivables, payables, cod, refunds, returns, adjustments, payouts] = await Promise.all([
    queryMany(
      `SELECT id, order_number, customer_name, amount::float8 AS amount, days FROM (${RECEIVABLES}) x
       WHERE days > 30 ORDER BY amount DESC, days DESC LIMIT 5`
    ),
    queryMany(
      `SELECT id, expense_number, supplier_name, due_date, amount::float8 AS amount, days FROM (${PAYABLES}) x
       WHERE amount > 0 AND due_date::date <= ${TODAY} + 7 ORDER BY due_date::date ASC, amount DESC LIMIT 5`
    ),
    queryMany(
      `SELECT id, order_number, COALESCE(customer_name, '') AS customer_name, total_amount::float8 AS amount,
         (${TODAY} - ${istDay('delivered_at')})::int AS days
       FROM orders
       WHERE payment_mode = 'cod' AND payment_status = 'cod_collected' AND delivered_at IS NOT NULL
         AND delivered_at < NOW() - ($1 || ' days')::interval
       ORDER BY delivered_at ASC LIMIT 5`,
      [String(COD_STALE_DAYS)]
    ),
    // Cancelled/returned but still marked paid (or COD collected): refund owed (Amazon refunds its own orders).
    queryMany(
      `SELECT id, order_number, COALESCE(customer_name, '') AS customer_name, status, total_amount::float8 AS amount,
         (${TODAY} - ${istDay('COALESCE(cancelled_at, updated_at)')})::int AS days
       FROM orders
       WHERE status IN ('cancelled', 'returned') AND payment_status IN ('paid', 'cod_collected') AND source <> 'amazon'
       ORDER BY COALESCE(cancelled_at, updated_at) ASC LIMIT 5`
    ),
    queryMany(
      `SELECT rr.id, rr.order_id, o.order_number, COALESCE(o.customer_name, '') AS customer_name,
         COALESCE((SELECT SUM(ri.refund_amount) FROM return_request_items ri WHERE ri.return_request_id = rr.id), 0)::float8 AS amount,
         (${TODAY} - ${istDay('COALESCE(rr.received_at, rr.updated_at)')})::int AS days
       FROM return_requests rr LEFT JOIN orders o ON o.id = rr.order_id
       WHERE rr.type = 'refund' AND rr.status = 'received'
       ORDER BY COALESCE(rr.received_at, rr.updated_at) ASC LIMIT 5`
    ),
    queryMany(
      `SELECT a.id, a.order_id, o.order_number, ABS(a.net_diff)::float8 AS amount,
         (${TODAY} - ${istDay('a.updated_at')})::int AS days
       FROM order_adjustments a JOIN orders o ON o.id = a.order_id
       WHERE a.refund_status = 'pending'
       ORDER BY a.updated_at ASC LIMIT 5`
    ),
    queryMany(
      `SELECT ep.id, e.id AS expense_id, e.expense_number, e.supplier_name, ep.amount::float8 AS amount, ep.payout_status,
         (${TODAY} - ${istDay('ep.created_at')})::int AS days
       FROM expense_payments ep JOIN expenses e ON e.id = ep.expense_id
       WHERE ep.payout_id IS NOT NULL
         AND (ep.payout_status IN ('failed', 'reversed')
              OR (ep.payout_status NOT IN ('processed', 'failed', 'reversed', 'cancelled') AND ep.created_at < NOW() - interval '2 days'))
       ORDER BY ep.created_at ASC LIMIT 5`
    ),
  ])
  return { receivables, payables, cod, refunds, returns, adjustments, payouts }
}

export type MixRow = { key: string; amount: number; count: number }

// FinanceOverviewContract<PeriodTotals> plus the overview-specific receivables/payables/cod,
// needs-attention lists, mix rows, top suppliers and AI roll-up the Overview tab needs.
export interface FinanceOverview extends FinanceOverviewContract<PeriodTotals, MixRow> {
  by_method: MixRow[]
  by_channel: MixRow[]
  receivables: { total: number; count: number; aging: { key: AgingKey; label: string; amount: number; count: number }[] }
  payables: {
    total: number; count: number
    due_7d: number; due_7d_count: number
    overdue: number; overdue_count: number
    aging: { key: AgingKey; label: string; amount: number; count: number }[]
    top_suppliers: { name: string; amount: number; n: number }[]
  }
  cod: { awaiting_remittance: number; awaiting_remittance_count: number; in_transit: number; in_transit_count: number }
  attention: {
    receivables: Record<string, any>[]
    payables: Record<string, any>[]
    cod: Record<string, any>[]
    refunds: Record<string, any>[]
    returns: Record<string, any>[]
    adjustments: Record<string, any>[]
    payouts: Record<string, any>[]
    cod_stale_days: number
  }
  ai: { flagship: boolean; amount: number; previous: number; calls: number }
}

export async function getFinanceOverview(range: Range, opts: { withGst: boolean; flagship?: boolean }): Promise<FinanceOverview> {
  const prev = previousPeriod(range)
  const bucket = bucketFor(range)
  const [current, previous, trend, mix, snap, att, aiCur, aiPrev] = await Promise.all([
    periodTotals(range, opts.withGst),
    periodTotals(prev, opts.withGst),
    series(range, bucket),
    breakdown(range),
    snapshot(),
    attention(),
    aiTotals(range),
    aiTotals(prev),
  ])
  // Flagship: what AI cost the platform. Tenant: what AI was charged to the wallet.
  const flagship = opts.flagship ?? true
  const aiAmount = (t: typeof aiCur) => (flagship ? t.cost_inr : t.price_inr)
  return {
    range,
    previous_range: prev,
    bucket,
    current,
    previous,
    series: trend,
    by_method: group(mix, 'method'),
    by_channel: group(mix, 'channel'),
    ...snap,
    attention: { ...att, cod_stale_days: COD_STALE_DAYS },
    ai: { flagship, amount: aiAmount(aiCur), previous: aiAmount(aiPrev), calls: aiCur.calls },
  }
}
