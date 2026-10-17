import type { AttentionItem } from '@/lib/overview/attention'
import { previousPeriod, type Bucket, type Period } from '@/lib/overview/period'

// Shared SQL pieces for the orders and fulfilment overviews, plus the Orders overview helpers.

/** IST bounds CTE: $1 previous start, $2 current start, $3 current end (inclusive day). The
 * previous period ends the day before the current one starts, so [p0, c1) covers both. */
export const BOUNDS = `b AS (
  SELECT ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS p0,
         ($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS c0,
         ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS c1)`

export const boundArgs = (p: Period) => {
  const prev = previousPeriod(p)
  return [prev.from, p.from, p.to]
}

/** `cur` / `prev` label for a timestamp already limited to [b.p0, b.c1). */
export const per = (col: string) => `CASE WHEN ${col} >= b.c0 THEN 'cur' ELSE 'prev' END`

/** `col` inside [b.p0, b.c1). */
export const inBoth = (col: string) => `${col} >= b.p0 AND ${col} < b.c1`
/** `col` inside the current period. */
export const inCur = (col: string) => `${col} >= b.c0 AND ${col} < b.c1`

/** Bucket start (IST date) of a timestamptz column. */
export const bucketSql = (col: string, bucket: Bucket) =>
  bucket === 'day'
    ? `(${col} AT TIME ZONE 'Asia/Kolkata')::date`
    : `date_trunc('${bucket}', ${col} AT TIME ZONE 'Asia/Kolkata')::date`

/** generate_series of bucket starts across the current period ($2..$3). */
export const bucketSeriesSql = (bucket: Bucket) =>
  bucket === 'day'
    ? `generate_series($2::date, $3::date, interval '1 day')`
    : `generate_series(date_trunc('${bucket}', $2::date), $3::date, interval '1 ${bucket}')`

/** Orders that go out by courier: online, or offline / business flagged for delivery, with a physical line. */
export const NEEDS_SHIP_SQL = `(o.source = 'online' OR o.needs_delivery)
  AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.is_digital IS NOT TRUE)`

export const n = (v: unknown) => (v == null ? 0 : Number(v))
export const nn = (v: unknown) => (v == null ? null : Number(v))

export type Row = Record<string, unknown>

export function byPeriod<T>(rows: Row[], map: (r: Row | undefined) => T): { current: T; previous: T } {
  return { current: map(rows.find(r => r.period === 'cur')), previous: map(rows.find(r => r.period === 'prev')) }
}

/** Fill the gaps in a bucketed series so the chart has every bucket. */
export function seriesFromRows<K extends string>(rows: Row[], keys: K[]): ({ label: string } & Record<K, number>)[] {
  return rows.map(r => {
    const o = { label: String(r.bucket) } as { label: string } & Record<K, number>
    for (const k of keys) (o as Record<string, unknown>)[k] = n(r[k])
    return o
  })
}

// ---- Orders ----

export type CancelReason = 'payment_timeout' | 'customer' | 'after_dispatch' | 'store'

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  payment_timeout: 'Payment not completed',
  customer: 'Customer cancelled',
  after_dispatch: 'Cancelled after dispatch',
  store: 'Cancelled by store',
}

/** No reason column exists: the customer cancel flow logs to customer_activity_log, and anything else is the store's. */
export const CANCEL_REASON_SQL = `CASE
  WHEN EXISTS (SELECT 1 FROM customer_activity_log a WHERE a.reference_id = o.id AND a.kind = 'order_status'
               AND a.metadata->>'reason' = 'auto_cancel_unpaid') THEN 'payment_timeout'
  WHEN o.shipped_at IS NOT NULL THEN 'after_dispatch'
  WHEN EXISTS (SELECT 1 FROM customer_activity_log a WHERE a.reference_id = o.id AND a.kind = 'order_status'
               AND a.actor_id IS NULL AND a.metadata->>'order_status' IN ('cancelled', 'cancel_requested')) THEN 'customer'
  ELSE 'store' END`

export const SOURCE_LABELS: Record<string, string> = {
  online: 'Online store',
  offline: 'Offline',
  business: 'Business',
  cash_sale: 'Cash sale',
  amazon: 'Amazon',
}

export const PIPELINE: { status: string; label: string }[] = [
  { status: 'pending', label: 'To confirm' },
  { status: 'confirmed', label: 'Confirmed' },
  { status: 'processing', label: 'Processing' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'out_for_delivery', label: 'Out for delivery' },
  { status: 'cancel_requested', label: 'Cancel requested' },
  { status: 'return_requested', label: 'Return requested' },
  { status: 'return_approved', label: 'Return approved' },
]

export interface OrdersSnapshot {
  toConfirm: number
  toConfirmStale: number
  oldestPending: string | null
  toShip: number
  lateToShip: number
  cancelRequests: number
  returnRequests: number
  overdueDelivery: number
  unpaidPrepaid: number
}

export function ordersAttention(s: OrdersSnapshot, handlingDays: number): AttentionItem[] {
  const out: AttentionItem[] = []
  const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  if (s.lateToShip)
    out.push({
      key: 'late_to_ship',
      severity: 'critical',
      title: `${plural(s.lateToShip, 'order')} past the ${handlingDays}-day dispatch window`,
      sub: 'Confirmed or processing and not shipped yet',
      href: '/admin/packing-slips',
    })
  if (s.cancelRequests)
    out.push({
      key: 'cancel_requests',
      severity: 'warning',
      title: `${plural(s.cancelRequests, 'cancellation request')} to review`,
      href: '/admin/orders?tab=list&status=cancel_requested',
    })
  if (s.toConfirmStale)
    out.push({
      key: 'to_confirm',
      severity: 'warning',
      title: `${plural(s.toConfirmStale, 'order')} waiting over a day to be confirmed`,
      href: '/admin/orders?tab=list&status=pending',
    })
  if (s.overdueDelivery)
    out.push({
      key: 'overdue_delivery',
      severity: 'warning',
      title: `${plural(s.overdueDelivery, 'shipment')} past the promised delivery date`,
      href: '/admin/delhivery',
    })
  if (s.returnRequests)
    out.push({
      key: 'return_requests',
      severity: 'info',
      title: `${plural(s.returnRequests, 'order')} with a return requested`,
      href: '/admin/returns?tab=list',
    })
  if (s.unpaidPrepaid)
    out.push({
      key: 'unpaid',
      severity: 'info',
      title: `${plural(s.unpaidPrepaid, 'prepaid order')} unpaid for over a day`,
      href: '/admin/orders?tab=list&payment_status=unpaid',
    })
  return out
}

/** One KPI in a strip overview; `previous` is null for point-in-time counts. */
export interface StripKpi {
  key: string
  label: string
  value: number | null
  previous: number | null
  format: 'count' | 'money' | 'hours' | 'days' | 'pct'
  /** Lower is better. */
  invert?: boolean
  sub?: string
}
