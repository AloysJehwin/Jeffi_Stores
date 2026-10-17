import type { AttentionItem } from '@/lib/overview/attention'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, type Period } from '@/lib/overview/period'
import {
  BOUNDS,
  boundArgs,
  bucketSeriesSql,
  bucketSql,
  byPeriod,
  inBoth,
  inCur,
  n,
  nn,
  per,
  seriesFromRows,
  type Row,
} from '@/lib/overviews/orders'

// Return and replacement requests share return_requests (type 'refund' | 'replacement').
// Statuses: pending_approval -> approved (RVP pickup) -> received -> completed, or rejected.

export type RequestType = 'refund' | 'replacement'

export const RETURN_REASON_LABELS: Record<string, string> = {
  defective: 'Defective',
  wrong_item: 'Wrong item',
  not_as_described: 'Not as described',
  damaged: 'Damaged in transit',
  other: 'Other',
}

export const CONDITION_LABELS: Record<string, string> = {
  good: 'Good (restockable)',
  defective: 'Defective',
  damaged: 'Damaged',
}

export const reasonLabel = (r: string) => RETURN_REASON_LABELS[r] ?? r.replace(/_/g, ' ')

export const OPEN_SQL = `rr.status NOT IN ('completed', 'rejected')`

export interface ReturnsSnapshot {
  pendingApproval: number
  pendingApprovalStale: number
  awaitingPickup: number
  inTransitBack: number
  pendingInspection: number
  inspectedNotClosed: number
}

export function returnsAttention(s: ReturnsSnapshot, type: RequestType): AttentionItem[] {
  const noun = type === 'refund' ? 'return' : 'replacement'
  const base = type === 'refund' ? '/admin/returns?tab=list' : '/admin/replacements?tab=list'
  const pl = (k: number) => `${k} ${noun}${k === 1 ? '' : 's'}`
  const out: AttentionItem[] = []
  if (s.pendingApprovalStale)
    out.push({
      key: 'approval_stale',
      severity: 'critical',
      title: `${pl(s.pendingApprovalStale)} waiting over 2 days for a decision`,
      href: base,
    })
  else if (s.pendingApproval)
    out.push({
      key: 'approval',
      severity: 'warning',
      title: `${pl(s.pendingApproval)} waiting for approval`,
      href: base,
    })
  if (s.pendingInspection)
    out.push({
      key: 'inspection',
      severity: 'warning',
      title: `${pl(s.pendingInspection)} received and waiting for inspection`,
      href: base,
    })
  if (s.inspectedNotClosed)
    out.push({
      key: 'close',
      severity: 'warning',
      title: `${pl(s.inspectedNotClosed)} inspected but not closed`,
      sub: type === 'refund' ? 'Issue the refund to close' : 'Ship the replacement to close',
      href: base,
    })
  if (s.awaitingPickup)
    out.push({
      key: 'pickup',
      severity: 'info',
      title: `${pl(s.awaitingPickup)} approved without a return pickup booked`,
      href: base,
    })
  return out
}

/** Requests per delivered order; null when nothing was delivered. */
export const returnRate = (requests: number, delivered: number) => (delivered ? requests / delivered : null)

// ---- Loader shared by the Returns overview and the Replacements strip ----

export async function loadReturnsOverview(type: RequestType, period: Period, opts: { full: boolean }) {
  const args = [...boundArgs(period), type]
  const bucket = bucketFor(period)
  const [kpiRows, closed, delivered, reasons, snapshot, conditions, products, series, oldest] = await Promise.all([
    queryMany<Row>(
      `WITH ${BOUNDS}
       SELECT ${per('rr.created_at')} AS period, COUNT(*) AS requests,
              COUNT(*) FILTER (WHERE rr.status = 'rejected') AS rejected,
              COALESCE(SUM((SELECT SUM(i.refund_amount) FROM return_request_items i WHERE i.return_request_id = rr.id)), 0) AS value,
              COALESCE(SUM((SELECT SUM(i.quantity) FROM return_request_items i WHERE i.return_request_id = rr.id)), 0) AS units
       FROM return_requests rr, b
       WHERE ${inBoth('rr.created_at')} AND rr.type = $4
       GROUP BY 1`,
      args
    ),
    queryMany<Row>(
      `WITH ${BOUNDS}
       SELECT ${per('rr.resolved_at')} AS period,
              COUNT(*) FILTER (WHERE rr.status = 'completed') AS completed,
              AVG(EXTRACT(EPOCH FROM rr.resolved_at - rr.created_at) / 86400) AS close_days,
              COALESCE(SUM((SELECT SUM(i.refund_amount) FROM return_request_items i WHERE i.return_request_id = rr.id))
                FILTER (WHERE rr.status = 'completed'), 0) AS refunded
       FROM return_requests rr, b
       WHERE ${inBoth('rr.resolved_at')} AND rr.type = $4 AND rr.status IN ('completed', 'rejected')
       GROUP BY 1`,
      args
    ),
    queryMany<Row>(
      `WITH ${BOUNDS}
       SELECT ${per('o.delivered_at')} AS period, COUNT(*) AS delivered
       FROM orders o, b
       WHERE ${inBoth('o.delivered_at')} AND o.status IN ('delivered', 'returned', 'return_requested', 'return_approved', 'return_received', 'return_rejected')
         AND $4::text IS NOT NULL -- binds the shared args
       GROUP BY 1`,
      args
    ),
    queryMany<Row>(
      `WITH ${BOUNDS}
       SELECT rr.reason, COUNT(*) AS count,
              COALESCE(SUM((SELECT SUM(i.refund_amount) FROM return_request_items i WHERE i.return_request_id = rr.id)), 0) AS value
       FROM return_requests rr, b
       WHERE ${inCur('rr.created_at')} AND rr.type = $4
       GROUP BY 1 ORDER BY count DESC`,
      args
    ),
    queryOne<Row>(
      `SELECT COUNT(*) FILTER (WHERE rr.status = 'pending_approval') AS pending_approval,
              COUNT(*) FILTER (WHERE rr.status = 'pending_approval' AND rr.created_at < NOW() - interval '2 days') AS pending_approval_stale,
              COUNT(*) FILTER (WHERE rr.status = 'approved' AND rr.rvp_awb_number IS NULL AND rr.received_at IS NULL) AS awaiting_pickup,
              COUNT(*) FILTER (WHERE rr.status = 'approved' AND rr.rvp_awb_number IS NOT NULL AND rr.received_at IS NULL) AS in_transit_back,
              COUNT(*) FILTER (WHERE ${OPEN_SQL} AND rr.status <> 'pending_approval'
                                 AND (rr.status = 'received' OR rr.received_at IS NOT NULL)
                                 AND rr.valuation_status IS DISTINCT FROM 'approved') AS pending_inspection,
              COUNT(*) FILTER (WHERE ${OPEN_SQL} AND rr.valuation_status = 'approved') AS inspected_not_closed,
              COUNT(*) FILTER (WHERE ${OPEN_SQL}) AS open
       FROM return_requests rr WHERE rr.type = $1`,
      [type]
    ),
    opts.full
      ? queryMany<Row>(
          `WITH ${BOUNDS}
           SELECT rr.valuation_condition AS condition, COUNT(*) AS count
           FROM return_requests rr, b
           WHERE ${inCur('rr.valuated_at')} AND rr.type = $4 AND rr.valuation_condition IS NOT NULL
           GROUP BY 1 ORDER BY count DESC`,
          args
        )
      : Promise.resolve([] as Row[]),
    opts.full
      ? queryMany<Row>(
          `WITH ${BOUNDS}
           SELECT i.product_id, MAX(i.product_name) AS name, COUNT(DISTINCT rr.id) AS requests,
                  COALESCE(SUM(i.quantity), 0) AS units, COALESCE(SUM(i.refund_amount), 0) AS value,
                  (SELECT p.slug FROM products p WHERE p.id = i.product_id) AS slug
           FROM return_requests rr JOIN return_request_items i ON i.return_request_id = rr.id, b
           WHERE ${inCur('rr.created_at')} AND rr.type = $4
           GROUP BY i.product_id ORDER BY requests DESC, value DESC LIMIT 8`,
          args
        )
      : Promise.resolve([] as Row[]),
    opts.full
      ? queryMany<Row>(
          `WITH ${BOUNDS},
           s AS (SELECT d::date AS bucket FROM ${bucketSeriesSql(bucket)} d),
           r AS (SELECT ${bucketSql('rr.created_at', bucket)} AS bucket, COUNT(*) AS requests
                 FROM return_requests rr, b WHERE ${inCur('rr.created_at')} AND rr.type = $4 GROUP BY 1)
           SELECT s.bucket::text AS bucket, COALESCE(r.requests, 0) AS requests
           FROM s LEFT JOIN r ON r.bucket = s.bucket ORDER BY s.bucket`,
          args
        )
      : Promise.resolve([] as Row[]),
    queryMany<Row>(
      `SELECT rr.id, rr.status, rr.reason, rr.created_at, o.id AS order_id, o.order_number,
              COALESCE(o.customer_name, '') AS customer
       FROM return_requests rr JOIN orders o ON o.id = rr.order_id
       WHERE rr.type = $1 AND ${OPEN_SQL}
       ORDER BY rr.created_at ASC LIMIT 6`,
      [type]
    ),
  ])

  const rq = byPeriod(kpiRows, r => r)
  const cl = byPeriod(closed, r => r)
  const dl = byPeriod(delivered, r => r)
  const kpi = (k: Row | undefined, c: Row | undefined, d: Row | undefined) => {
    const requests = n(k?.requests)
    return {
      requests,
      units: n(k?.units),
      value: n(k?.value),
      rejected: n(k?.rejected),
      delivered: n(d?.delivered),
      rate: returnRate(requests, n(d?.delivered)),
      completed: n(c?.completed),
      refunded: n(c?.refunded),
      closeDays: nn(c?.close_days),
    }
  }
  const snap: ReturnsSnapshot & { open: number } = {
    pendingApproval: n(snapshot?.pending_approval),
    pendingApprovalStale: n(snapshot?.pending_approval_stale),
    awaitingPickup: n(snapshot?.awaiting_pickup),
    inTransitBack: n(snapshot?.in_transit_back),
    pendingInspection: n(snapshot?.pending_inspection),
    inspectedNotClosed: n(snapshot?.inspected_not_closed),
    open: n(snapshot?.open),
  }

  return {
    period,
    previous: previousPeriod(period),
    bucket,
    kpis: { current: kpi(rq.current, cl.current, dl.current), previous: kpi(rq.previous, cl.previous, dl.previous) },
    snapshot: snap,
    byReason: reasons.map(r => ({
      reason: String(r.reason),
      label: reasonLabel(String(r.reason)),
      count: n(r.count),
      value: n(r.value),
    })),
    byCondition: conditions.map(r => ({
      condition: String(r.condition),
      label: CONDITION_LABELS[String(r.condition)] ?? String(r.condition),
      count: n(r.count),
    })),
    topProducts: products.map(r => ({
      productId: (r.product_id as string) ?? null,
      name: String(r.name ?? 'Unknown product'),
      slug: (r.slug as string) ?? null,
      requests: n(r.requests),
      units: n(r.units),
      value: n(r.value),
    })),
    series: seriesFromRows(series, ['requests']),
    oldestOpen: oldest.map(r => ({
      id: String(r.id),
      status: String(r.status),
      reason: reasonLabel(String(r.reason)),
      createdAt: r.created_at,
      orderId: String(r.order_id),
      orderNumber: String(r.order_number),
      customer: String(r.customer),
    })),
    attention: returnsAttention(snap, type),
  }
}
