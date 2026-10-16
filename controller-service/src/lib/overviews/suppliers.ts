import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, ratio, type Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/components/admin/overview/kit'
import { kpi, n, nn, plural, snapshot, type OverviewKpi } from './ops-kpi'

// Suppliers overview. Received value is GRN lines (qty x unit cost) by received date; raised is
// PO totals by order date; paid follows finance (live expense payments). Open POs follow the
// dashboard (not received, cancelled, closed or completed). A PO is on time when its last GRN is
// on or before its expected date. Bills link to a supplier through their PO, else by name.

const CLOSED = `('received', 'cancelled', 'closed', 'completed')`
const LIVE_PAYOUT = `COALESCE(ep.payout_status, '') NOT IN ('failed', 'reversed', 'cancelled')`
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
export const DUE_SOON_DAYS = 7
export const STALE_DRAFT_DAYS = 7

// Open supplier bills with their supplier and days past due.
export const PAYABLES = `
  SELECT e.id, e.due_date, COALESCE(po.supplier_id, s.id) AS supplier_id, e.supplier_name,
    e.total_amount - COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id AND ${LIVE_PAYOUT}), 0) AS amount,
    COALESCE(${TODAY} - e.due_date, 0)::int AS days
  FROM expenses e
  LEFT JOIN purchase_orders po ON po.id = e.po_id
  LEFT JOIN LATERAL (SELECT id FROM suppliers WHERE lower(name) = lower(e.supplier_name) ORDER BY is_active DESC LIMIT 1) s ON po.id IS NULL
  WHERE e.status != 'paid'`

// Per PO in the window: last and first GRN date, for on-time and lead time.
const DELIVERIES = (a: number, b: number) => `
  SELECT po.id, po.supplier_id, po.order_date, po.expected_date, MIN(g.received_date) AS first_grn, MAX(g.received_date) AS last_grn
  FROM purchase_orders po JOIN grns g ON g.po_id = po.id
  GROUP BY po.id
  HAVING MAX(g.received_date) BETWEEN $${a}::date AND $${b}::date`

export interface SupplierTotals {
  received_value: number
  grns: number
  raised_value: number
  pos_raised: number
  paid: number
  delivered: number
  with_expected: number
  on_time: number
  on_time_rate: number | null
  lead_days: number | null
}

export function supplierTotals(r: Record<string, unknown> | null | undefined): SupplierTotals {
  const delivered = n(r?.delivered)
  const onTime = n(r?.on_time)
  return {
    received_value: n(r?.received_value),
    grns: n(r?.grns),
    raised_value: n(r?.raised_value),
    pos_raised: n(r?.pos_raised),
    paid: n(r?.paid),
    delivered,
    with_expected: n(r?.with_expected),
    on_time: onTime,
    on_time_rate: ratio(onTime, n(r?.with_expected)),
    lead_days: nn(r?.lead_days),
  }
}

async function totals(p: Period) {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT
       (SELECT COALESCE(SUM(gi.quantity_received * gi.unit_cost), 0) FROM grn_items gi JOIN grns g ON g.id = gi.grn_id
         WHERE g.received_date BETWEEN $1::date AND $2::date) AS received_value,
       (SELECT COUNT(*) FROM grns g WHERE g.received_date BETWEEN $1::date AND $2::date) AS grns,
       (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders
         WHERE order_date BETWEEN $1::date AND $2::date AND COALESCE(status, '') NOT IN ('draft', 'cancelled')) AS raised_value,
       (SELECT COUNT(*) FROM purchase_orders
         WHERE order_date BETWEEN $1::date AND $2::date AND COALESCE(status, '') NOT IN ('draft', 'cancelled')) AS pos_raised,
       (SELECT COALESCE(SUM(ep.amount), 0) FROM expense_payments ep
         WHERE ep.payment_date BETWEEN $1::date AND $2::date AND ${LIVE_PAYOUT}) AS paid,
       d.delivered, d.with_expected, d.on_time, d.lead_days
     FROM (SELECT COUNT(*) AS delivered,
                  COUNT(*) FILTER (WHERE expected_date IS NOT NULL) AS with_expected,
                  COUNT(*) FILTER (WHERE expected_date IS NOT NULL AND last_grn <= expected_date) AS on_time,
                  AVG(first_grn - order_date) AS lead_days
           FROM (${DELIVERIES(1, 2)}) x) d`,
    [p.from, p.to]
  )
  return supplierTotals(row)
}

export interface OverduePo {
  id: string
  po_number: string
  supplier_name: string | null
  expected_date: string
  days_late: number
  total_amount: number
}

export function supplierAttention(
  overdue: OverduePo[],
  payables: { overdue_amount: number; overdue_count: number; due_soon_amount: number; due_soon_count: number },
  staleDrafts: number
): AttentionItem[] {
  const out: AttentionItem[] = []
  if (payables.overdue_count)
    out.push({
      key: 'payables_overdue',
      severity: 'critical',
      title: `Rs ${Math.round(payables.overdue_amount).toLocaleString('en-IN')} of supplier bills past due`,
      sub: plural(payables.overdue_count, 'bill'),
      href: '/admin/financial?tab=payables',
    })
  if (overdue.length) {
    const worst = overdue[0]
    out.push({
      key: 'po_overdue',
      severity: overdue.some(o => o.days_late > 7) ? 'critical' : 'warning',
      title: `${plural(overdue.length, 'purchase order')} past the expected date`,
      sub: `Latest: ${worst.po_number}${worst.supplier_name ? ` (${worst.supplier_name})` : ''}, ${worst.days_late} d late`,
      href: `/admin/purchase-orders?tab=orders&po=${worst.id}`,
    })
  }
  if (payables.due_soon_count)
    out.push({
      key: 'payables_due',
      severity: 'warning',
      title: `Rs ${Math.round(payables.due_soon_amount).toLocaleString('en-IN')} due to suppliers in the next ${DUE_SOON_DAYS} days`,
      sub: plural(payables.due_soon_count, 'bill'),
      href: '/admin/financial?tab=payables',
    })
  if (staleDrafts)
    out.push({
      key: 'drafts',
      severity: 'info',
      title: `${plural(staleDrafts, 'draft PO')} not sent for over ${STALE_DRAFT_DAYS} days`,
      href: '/admin/purchase-orders?tab=orders',
    })
  return out
}

export async function getSupplierOverview(period: Period) {
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const [current, prev, open, payables, series, top, overdue, drafts] = await Promise.all([
    totals(period),
    totals(previous),
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) AS open, COALESCE(SUM(total_amount), 0) AS open_value,
              COUNT(*) FILTER (WHERE status = 'draft') AS drafts,
              (SELECT COUNT(*) FROM suppliers WHERE is_active) AS active_suppliers
       FROM purchase_orders WHERE COALESCE(status, '') NOT IN ${CLOSED}`
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count,
              COALESCE(SUM(amount) FILTER (WHERE days > 0), 0) AS overdue_amount, COUNT(*) FILTER (WHERE days > 0) AS overdue_count,
              COALESCE(SUM(amount) FILTER (WHERE days BETWEEN -${DUE_SOON_DAYS} AND 0 AND due_date IS NOT NULL), 0) AS due_soon_amount,
              COUNT(*) FILTER (WHERE days BETWEEN -${DUE_SOON_DAYS} AND 0 AND due_date IS NOT NULL) AS due_soon_count
       FROM (${PAYABLES}) x WHERE amount > 0`
    ),
    queryMany<Record<string, unknown>>(
      `WITH s AS (SELECT g::date AS b FROM generate_series(date_trunc('${bucket}', $1::date::timestamp), $2::date::timestamp, interval '1 ${bucket}') g)
       SELECT s.b::text AS label,
              COALESCE((SELECT SUM(gi.quantity_received * gi.unit_cost) FROM grn_items gi JOIN grns g ON g.id = gi.grn_id
                WHERE g.received_date BETWEEN $1::date AND $2::date AND date_trunc('${bucket}', g.received_date::timestamp)::date = s.b), 0) AS received,
              COALESCE((SELECT SUM(total_amount) FROM purchase_orders po
                WHERE po.order_date BETWEEN $1::date AND $2::date AND COALESCE(po.status, '') NOT IN ('draft', 'cancelled')
                  AND date_trunc('${bucket}', po.order_date::timestamp)::date = s.b), 0) AS raised
       FROM s ORDER BY s.b`,
      [period.from, period.to]
    ),
    queryMany<Record<string, unknown>>(
      `WITH recv AS (
         SELECT g.supplier_id, SUM(gi.quantity_received * gi.unit_cost) AS received, COUNT(DISTINCT g.id) AS grns
         FROM grns g JOIN grn_items gi ON gi.grn_id = g.id
         WHERE g.received_date BETWEEN $1::date AND $2::date GROUP BY 1),
       del AS (
         SELECT supplier_id, COUNT(*) FILTER (WHERE expected_date IS NOT NULL) AS with_expected,
                COUNT(*) FILTER (WHERE expected_date IS NOT NULL AND last_grn <= expected_date) AS on_time,
                AVG(first_grn - order_date) AS lead_days
         FROM (${DELIVERIES(1, 2)}) x GROUP BY 1),
       pay AS (SELECT supplier_id, SUM(amount) AS payable FROM (${PAYABLES}) x WHERE amount > 0 GROUP BY 1),
       openpo AS (SELECT supplier_id, COUNT(*) AS open_pos FROM purchase_orders WHERE COALESCE(status, '') NOT IN ${CLOSED} GROUP BY 1)
       SELECT s.id, s.name, COALESCE(recv.received, 0) AS received, COALESCE(recv.grns, 0) AS grns,
              del.with_expected, del.on_time, del.lead_days, COALESCE(pay.payable, 0) AS payable, COALESCE(openpo.open_pos, 0) AS open_pos
       FROM suppliers s
       LEFT JOIN recv ON recv.supplier_id = s.id
       LEFT JOIN del ON del.supplier_id = s.id
       LEFT JOIN pay ON pay.supplier_id = s.id
       LEFT JOIN openpo ON openpo.supplier_id = s.id
       WHERE recv.received > 0 OR pay.payable > 0 OR openpo.open_pos > 0
       ORDER BY COALESCE(recv.received, 0) DESC, COALESCE(pay.payable, 0) DESC LIMIT 10`,
      [period.from, period.to]
    ),
    queryMany<Record<string, unknown>>(
      `SELECT po.id, po.po_number, s.name AS supplier_name, po.expected_date::text AS expected_date,
              (${TODAY} - po.expected_date)::int AS days_late, po.total_amount
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE COALESCE(po.status, '') NOT IN ${CLOSED} AND po.status != 'draft' AND po.expected_date < ${TODAY}
       ORDER BY po.expected_date ASC LIMIT 20`
    ),
    queryOne<{ n: string }>(
      `SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'draft' AND created_at < now() - interval '${STALE_DRAFT_DAYS} days'`
    ),
  ])

  const pay = {
    amount: n(payables?.amount),
    count: n(payables?.count),
    overdue_amount: n(payables?.overdue_amount),
    overdue_count: n(payables?.overdue_count),
    due_soon_amount: n(payables?.due_soon_amount),
    due_soon_count: n(payables?.due_soon_count),
  }
  const overduePos: OverduePo[] = overdue.map(o => ({
    id: String(o.id),
    po_number: String(o.po_number),
    supplier_name: (o.supplier_name as string | null) ?? null,
    expected_date: String(o.expected_date),
    days_late: n(o.days_late),
    total_amount: n(o.total_amount),
  }))
  // Most overdue first for the headline.
  overduePos.sort((a, b) => b.days_late - a.days_late)

  const kpis: OverviewKpi[] = [
    kpi('received', 'Purchases received', current.received_value, prev.received_value, 'money', {
      sub: plural(current.grns, 'GRN'),
    }),
    kpi('raised', 'POs raised', current.raised_value, prev.raised_value, 'money', {
      sub: plural(current.pos_raised, 'PO'),
    }),
    kpi('paid', 'Paid to suppliers', current.paid, prev.paid, 'money'),
    snapshot('open', 'Open POs', n(open?.open), 'count', {
      sub: `Rs ${Math.round(n(open?.open_value)).toLocaleString('en-IN')}`,
    }),
    kpi('on_time', 'On-time delivery', current.on_time_rate, prev.on_time_rate, 'pct', {
      sub: `${current.on_time} of ${current.with_expected} with a due date`,
    }),
    kpi('lead', 'Avg lead time', current.lead_days, prev.lead_days, 'days', { invert: true }),
    snapshot('payables', 'Payables due', pay.amount, 'money', { invert: true, sub: plural(pay.count, 'bill') }),
    snapshot('suppliers', 'Active suppliers', n(open?.active_suppliers), 'count'),
  ]

  return {
    range: period,
    previous_range: previous,
    bucket,
    kpis,
    current,
    previous: prev,
    payables: pay,
    series: series.map(s => ({ label: String(s.label), received: n(s.received), raised: n(s.raised) })),
    top_suppliers: top.map(t => ({
      id: String(t.id),
      name: String(t.name),
      received: n(t.received),
      grns: n(t.grns),
      on_time_rate: ratio(n(t.on_time), n(t.with_expected)),
      lead_days: nn(t.lead_days),
      payable: n(t.payable),
      open_pos: n(t.open_pos),
    })),
    overdue_pos: overduePos.slice(0, 8),
    attention: supplierAttention(overduePos, pay, n(drafts?.n)),
  }
}
