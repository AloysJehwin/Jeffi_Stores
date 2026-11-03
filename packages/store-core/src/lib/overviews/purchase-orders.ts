import type { FilterScope } from '@jeffi/list-filters'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, ratio, spanDays, type Period } from '@/lib/overview/period'
import { buildReorder } from '@/lib/purchasing/reorder'
import { LEAVES } from '@/lib/purchasing/leaves-sql'
import { kpi, n, nn, plural, snapshot, type OverviewKpi } from './ops-kpi'
import { PAYABLES, STALE_DRAFT_DAYS } from './suppliers'

// Purchase orders overview. Raised = PO totals by order date (not draft or cancelled); received =
// GRN lines (qty x unit cost) by received date. Open = draft, sent or partial. Reorder suggestions
// use the inventory overview's cover rule, net of quantity still due on open POs.

// Same shape as the overview kit's AttentionItem (src/lib may not import components).
export interface AttentionItem {
  key: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  sub?: string
  href?: string
}

const OPEN = `('draft', 'sent', 'partial')`
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
export const STALLED_PARTIAL_DAYS = 14

/** The list's filters on `po` and, for GRN rows, as a PO id list; both bound from `start` with the same params. */
interface PoScope {
  po: string
  grn: string
  params: unknown[]
}
function scoped(scope: FilterScope | undefined, start: number): PoScope {
  if (!scope || scope.empty) return { po: '', grn: '', params: [] }
  // PO filters have no base conditions, so both fragments bind the same values in the same order.
  const a = scope.and(start)
  return { po: a.sql, grn: scope.inIds('g.po_id', start).sql, params: a.params }
}

async function totals(p: Period, f: PoScope) {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT
       (SELECT COALESCE(SUM(po.total_amount), 0) FROM purchase_orders po
         WHERE po.order_date BETWEEN $1::date AND $2::date AND COALESCE(po.status, '') NOT IN ('draft', 'cancelled')${f.po}) AS raised_value,
       (SELECT COUNT(*) FROM purchase_orders po
         WHERE po.order_date BETWEEN $1::date AND $2::date AND COALESCE(po.status, '') NOT IN ('draft', 'cancelled')${f.po}) AS raised_count,
       (SELECT COALESCE(SUM(gi.quantity_received * gi.unit_cost), 0) FROM grn_items gi JOIN grns g ON g.id = gi.grn_id
         WHERE g.received_date BETWEEN $1::date AND $2::date${f.grn}) AS received_value,
       (SELECT COUNT(*) FROM grns g WHERE g.received_date BETWEEN $1::date AND $2::date${f.grn}) AS grns,
       (SELECT COUNT(*) FROM purchase_orders po
         WHERE po.order_date BETWEEN $1::date AND $2::date AND po.status = 'cancelled'${f.po}) AS cancelled`,
    [p.from, p.to, ...f.params]
  )
  const raised = n(row?.raised_value)
  const count = n(row?.raised_count)
  return {
    raised_value: raised,
    raised_count: count,
    avg_value: count ? raised / count : null,
    received_value: n(row?.received_value),
    grns: n(row?.grns),
    cancelled: n(row?.cancelled),
  }
}

export interface OpenPo {
  id: string
  po_number: string
  supplier_name: string | null
  status: string
  expected_date: string | null
  days_late: number
  total_amount: number
  received_share: number
  last_grn: string | null
}

export interface ReorderLine {
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  name: string
  leaf_name: string | null
  sku: string | null
  qty: number
  inbound: number
  suggestedQty: number
  daysOfCover: number
  unit_cost: number
}

export interface ReorderGroup {
  supplier_id: string | null
  supplier_name: string | null
  lines: ReorderLine[]
  value: number
}

/** Groups reorder lines by supplier (unknown supplier last), biggest spend first. */
export function groupReorder(
  rows: (ReorderLine & { supplier_id: string | null; supplier_name: string | null })[]
): ReorderGroup[] {
  const map = new Map<string, ReorderGroup>()
  for (const r of rows) {
    const key = r.supplier_id || ''
    let g = map.get(key)
    if (!g) {
      g = { supplier_id: r.supplier_id, supplier_name: r.supplier_name, lines: [], value: 0 }
      map.set(key, g)
    }
    const { supplier_id: _s, supplier_name: _n, ...line } = r
    g.lines.push(line)
    g.value += line.suggestedQty * line.unit_cost
  }
  return [...map.values()].sort((a, b) => (!a.supplier_id ? 1 : !b.supplier_id ? -1 : b.value - a.value))
}

export function poAttention(
  open: OpenPo[],
  staleDrafts: number,
  payablesOverdue: { amount: number; count: number },
  query = ''
): AttentionItem[] {
  const out: AttentionItem[] = []
  const list = (patch: Record<string, string>) => {
    const q = new URLSearchParams(query)
    for (const [k, v] of Object.entries(patch)) q.set(k, v)
    return `/admin/purchase-orders?tab=orders&${q}`
  }
  const late = open.filter(p => p.days_late > 0).sort((a, b) => b.days_late - a.days_late)
  if (late.length) {
    const w = late[0]
    out.push({
      key: 'po_overdue',
      severity: late.some(p => p.days_late > 7) ? 'critical' : 'warning',
      title: `${plural(late.length, 'purchase order')} past the expected date`,
      sub: `Latest: ${w.po_number}${w.supplier_name ? ` (${w.supplier_name})` : ''}, ${w.days_late} d late`,
      href: late.length > 1 ? list({ overdue: 'true' }) : `/admin/purchase-orders?tab=orders&po=${w.id}`,
    })
  }
  const stalled = open.filter(
    p => p.status === 'partial' && p.last_grn && Date.now() - Date.parse(p.last_grn) > STALLED_PARTIAL_DAYS * 86_400_000
  )
  if (stalled.length)
    out.push({
      key: 'po_stalled',
      severity: 'warning',
      title: `${plural(stalled.length, 'partly received PO')} with no delivery in ${STALLED_PARTIAL_DAYS} days`,
      sub: stalled
        .slice(0, 3)
        .map(p => p.po_number)
        .join(', '),
      href: `/admin/purchase-orders?tab=orders&po=${stalled[0].id}`,
    })
  const noDate = open.filter(p => p.status === 'sent' && !p.expected_date)
  if (noDate.length)
    out.push({
      key: 'po_no_date',
      severity: 'info',
      title: `${plural(noDate.length, 'sent PO')} without an expected delivery date`,
      href: `/admin/purchase-orders?tab=orders&po=${noDate[0].id}`,
    })
  if (payablesOverdue.count)
    out.push({
      key: 'payables_overdue',
      severity: 'critical',
      title: `Rs ${Math.round(payablesOverdue.amount).toLocaleString('en-IN')} of supplier bills past due`,
      sub: plural(payablesOverdue.count, 'bill'),
      href: '/admin/financial?tab=payables',
    })
  if (staleDrafts)
    out.push({
      key: 'drafts',
      severity: 'info',
      title: `${plural(staleDrafts, 'draft PO')} not sent for over ${STALE_DRAFT_DAYS} days`,
      href: list({ status: 'draft' }),
    })
  return out
}

// $1/$2 = period, $3 = days. Sales net of returns per leaf, plus quantity still due on open POs.
const REORDER_SQL = `${LEAVES}
, sales AS (
  SELECT it.product_id, it.variant_id, it.sub_variant_id, SUM(-it.quantity_change) AS sold
  FROM inventory_transactions it
  WHERE it.transaction_type IN ('sale', 'return')
    AND it.created_at >= ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
    AND it.created_at < (($2::date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
  GROUP BY 1, 2, 3
),
inbound AS (
  SELECT poi.product_id, poi.variant_id, poi.sub_variant_id,
         SUM(GREATEST(poi.quantity - COALESCE(poi.quantity_received, 0), 0)) AS due
  FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
  WHERE po.status IN ${OPEN}
  GROUP BY 1, 2, 3
)
SELECT l.product_id, l.variant_id, l.sub_variant_id, l.name, l.leaf_name, l.sku,
       l.qty, COALESCE(i.due, 0) AS inbound, l.qty + COALESCE(i.due, 0) AS effective_qty,
       s.sold, l.unit_cost, ps.lead_time_days, ps.moq, ps.purchase_unit_factor,
       COALESCE(ps.supplier_id, l.supplier_id) AS supplier_id, su.name AS supplier_name,
       COALESCE(ps.unit_cost, l.unit_cost) AS buy_cost
FROM priced l
JOIN sales s ON s.product_id = l.product_id
  AND s.variant_id IS NOT DISTINCT FROM l.variant_id AND s.sub_variant_id IS NOT DISTINCT FROM l.sub_variant_id
LEFT JOIN inbound i ON i.product_id = l.product_id
  AND i.variant_id IS NOT DISTINCT FROM l.variant_id AND i.sub_variant_id IS NOT DISTINCT FROM l.sub_variant_id
LEFT JOIN LATERAL (
  SELECT ps.supplier_id, ps.lead_time_days, ps.moq, ps.purchase_unit_factor, ps.unit_cost FROM product_suppliers ps
  WHERE ps.product_id = l.product_id AND ps.is_active = TRUE
    AND ps.variant_id IS NOT DISTINCT FROM (CASE WHEN l.sub_variant_id IS NULL THEN l.variant_id END)
    AND ps.sub_variant_id IS NOT DISTINCT FROM l.sub_variant_id
  ORDER BY ps.is_preferred DESC, ps.effective_date DESC LIMIT 1
) ps ON TRUE
LEFT JOIN suppliers su ON su.id = COALESCE(ps.supplier_id, l.supplier_id)
WHERE s.sold > 0 AND (l.qty + COALESCE(i.due, 0)) * $3::numeric < s.sold * 90
ORDER BY GREATEST(l.qty + COALESCE(i.due, 0), 0) / s.sold ASC
LIMIT 200`

/** `scope` is the list's filters (without the order date, which the period owns); payables and reorder stay store-wide. */
export async function getPurchaseOrderOverview(period: Period, scope?: FilterScope, query?: string) {
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const days = spanDays(period)
  const s1 = scoped(scope, 1)
  const s3 = scoped(scope, 3)
  const [current, prev, openRows, byStatus, series, topSuppliers, payables, drafts, reorderRows, onTime] =
    await Promise.all([
      totals(period, s3),
      totals(previous, s3),
      queryMany<Record<string, unknown>>(
        `SELECT po.id, po.po_number, s.name AS supplier_name, po.status, po.expected_date::text AS expected_date,
                CASE WHEN po.status IN ('sent', 'partial') AND po.expected_date < ${TODAY}
                     THEN (${TODAY} - po.expected_date)::int ELSE 0 END AS days_late,
                po.total_amount,
                (SELECT CASE WHEN SUM(poi.quantity) > 0
                        THEN SUM(LEAST(COALESCE(poi.quantity_received, 0), poi.quantity)) / SUM(poi.quantity) ELSE 0 END
                   FROM purchase_order_items poi WHERE poi.po_id = po.id) AS received_share,
                (SELECT MAX(g.received_date)::text FROM grns g WHERE g.po_id = po.id) AS last_grn
         FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.status IN ${OPEN}${s1.po}
         ORDER BY po.expected_date ASC NULLS LAST, po.order_date ASC
         LIMIT 500`,
        s1.params
      ),
      queryMany<Record<string, unknown>>(
        `SELECT po.status, COUNT(*) AS count, COALESCE(SUM(po.total_amount), 0) AS value
         FROM purchase_orders po WHERE po.status IN ${OPEN}${s1.po} GROUP BY po.status`,
        s1.params
      ),
      queryMany<Record<string, unknown>>(
        `WITH s AS (SELECT g::date AS b FROM generate_series(date_trunc('${bucket}', $1::date::timestamp), $2::date::timestamp, interval '1 ${bucket}') g)
         SELECT s.b::text AS label,
                COALESCE((SELECT SUM(total_amount) FROM purchase_orders po
                  WHERE po.order_date BETWEEN $1::date AND $2::date AND COALESCE(po.status, '') NOT IN ('draft', 'cancelled')
                    AND date_trunc('${bucket}', po.order_date::timestamp)::date = s.b${s3.po}), 0) AS raised,
                COALESCE((SELECT SUM(gi.quantity_received * gi.unit_cost) FROM grn_items gi JOIN grns g ON g.id = gi.grn_id
                  WHERE g.received_date BETWEEN $1::date AND $2::date AND date_trunc('${bucket}', g.received_date::timestamp)::date = s.b${s3.grn}), 0) AS received
         FROM s ORDER BY s.b`,
        [period.from, period.to, ...s3.params]
      ),
      queryMany<Record<string, unknown>>(
        `SELECT s.id, s.name, SUM(po.total_amount) AS value, COUNT(*) AS pos
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.order_date BETWEEN $1::date AND $2::date AND COALESCE(po.status, '') NOT IN ('draft', 'cancelled')${s3.po}
         GROUP BY s.id, s.name ORDER BY value DESC LIMIT 8`,
        [period.from, period.to, ...s3.params]
      ),
      queryOne<Record<string, unknown>>(
        `SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count,
                COALESCE(SUM(amount) FILTER (WHERE days > 0), 0) AS overdue_amount, COUNT(*) FILTER (WHERE days > 0) AS overdue_count
         FROM (${PAYABLES}) x WHERE amount > 0`
      ),
      queryOne<{ n: string }>(
        `SELECT COUNT(*) AS n FROM purchase_orders po
         WHERE po.status = 'draft' AND po.created_at < now() - interval '${STALE_DRAFT_DAYS} days'${s1.po}`,
        s1.params
      ),
      queryMany<Record<string, unknown>>(REORDER_SQL, [period.from, period.to, days]),
      queryOne<Record<string, unknown>>(
        `SELECT COUNT(*) FILTER (WHERE expected_date IS NOT NULL) AS with_expected,
                COUNT(*) FILTER (WHERE expected_date IS NOT NULL AND last_grn <= expected_date) AS on_time
         FROM (SELECT po.expected_date, MAX(g.received_date) AS last_grn
               FROM purchase_orders po JOIN grns g ON g.po_id = po.id
               WHERE po.status = 'received'${s3.po}
               GROUP BY po.id HAVING MAX(g.received_date) BETWEEN $1::date AND $2::date) x`,
        [period.from, period.to, ...s3.params]
      ),
    ])

  const open: OpenPo[] = openRows.map(r => ({
    id: String(r.id),
    po_number: String(r.po_number),
    supplier_name: (r.supplier_name as string | null) ?? null,
    status: String(r.status),
    expected_date: (r.expected_date as string | null) ?? null,
    days_late: n(r.days_late),
    total_amount: n(r.total_amount),
    received_share: n(r.received_share),
    last_grn: (r.last_grn as string | null) ?? null,
  }))
  const overdue = open.filter(p => p.days_late > 0).sort((a, b) => b.days_late - a.days_late)
  const partial = open.filter(p => p.status === 'partial')
  const openValue = open.reduce((s, p) => s + p.total_amount, 0)
  const pay = {
    amount: n(payables?.amount),
    count: n(payables?.count),
    overdue_amount: n(payables?.overdue_amount),
    overdue_count: n(payables?.overdue_count),
  }

  const reorder = groupReorder(
    buildReorder(
      reorderRows.map(r => ({
        product_id: String(r.product_id),
        variant_id: (r.variant_id as string | null) ?? null,
        sub_variant_id: (r.sub_variant_id as string | null) ?? null,
        name: String(r.name),
        leaf_name: (r.leaf_name as string | null) ?? null,
        sku: (r.sku as string | null) ?? null,
        // Cover counts stock already on order; the suggestion tops up from there.
        qty: n(r.effective_qty),
        onHand: n(r.qty),
        inbound: n(r.inbound),
        sold: n(r.sold),
        unit_cost: n(r.buy_cost),
        lead_time_days: r.lead_time_days,
        moq: r.moq,
        purchase_unit_factor: r.purchase_unit_factor,
        supplier_id: (r.supplier_id as string | null) ?? null,
        supplier_name: (r.supplier_name as string | null) ?? null,
      })),
      days,
      40
    ).map(r => ({
      product_id: r.product_id,
      variant_id: r.variant_id,
      sub_variant_id: r.sub_variant_id,
      name: r.name,
      leaf_name: r.leaf_name,
      sku: r.sku,
      qty: r.onHand,
      inbound: r.inbound,
      suggestedQty: r.suggestedQty,
      daysOfCover: r.daysOfCover,
      unit_cost: r.unit_cost,
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
    }))
  )

  const statusRow = (s: string) => byStatus.find(r => r.status === s)
  const kpis: OverviewKpi[] = [
    kpi('raised', 'POs raised', current.raised_value, prev.raised_value, 'money', {
      sub: plural(current.raised_count, 'PO'),
    }),
    kpi('received', 'Goods received', current.received_value, prev.received_value, 'money', {
      sub: plural(current.grns, 'GRN'),
    }),
    kpi('avg', 'Avg PO value', current.avg_value, prev.avg_value, 'money'),
    snapshot('open', 'Open POs', open.length, 'count', { sub: `Rs ${Math.round(openValue).toLocaleString('en-IN')}` }),
    snapshot('overdue', 'Overdue deliveries', overdue.length, 'count', {
      invert: true,
      sub: `Rs ${Math.round(overdue.reduce((s, p) => s + p.total_amount, 0)).toLocaleString('en-IN')}`,
    }),
    snapshot('partial', 'Partially received', partial.length, 'count'),
    snapshot('on_time', 'On-time (closed)', ratio(n(onTime?.on_time), n(onTime?.with_expected)), 'pct', {
      sub: `${n(onTime?.on_time)} of ${n(onTime?.with_expected)} with a due date`,
    }),
    snapshot('payables', 'Payables due', pay.amount, 'money', { invert: true, sub: plural(pay.count, 'bill') }),
  ]

  return {
    range: period,
    previous_range: previous,
    bucket,
    kpis,
    current,
    previous: prev,
    series: series.map(s => ({ label: String(s.label), raised: n(s.raised), received: n(s.received) })),
    by_status: ['draft', 'sent', 'partial'].map(s => ({
      status: s,
      count: n(statusRow(s)?.count),
      value: n(statusRow(s)?.value),
    })),
    top_suppliers: topSuppliers.map(t => ({ id: String(t.id), name: String(t.name), value: n(t.value), pos: n(t.pos) })),
    overdue: overdue.slice(0, 10),
    partial: partial
      .sort((a, b) => a.received_share - b.received_share)
      .slice(0, 10)
      .map(p => ({ ...p, received_share: nn(p.received_share) ?? 0 })),
    reorder,
    payables: pay,
    attention: poAttention(open, n(drafts?.n), { amount: pay.overdue_amount, count: pay.overdue_count }, query),
    filtered: !!scope && !scope.empty,
  }
}
