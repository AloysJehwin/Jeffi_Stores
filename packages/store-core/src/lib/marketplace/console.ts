import { queryMany, queryOne } from '@/lib/shared/db'
import type { MarketplaceChannel, MarketStatus, ReturnStatus } from './types'

// Read models behind the Myntra / AJIO consoles: overview KPIs, the orders queue and returns.

export const QUEUE_BUCKETS = ['new', 'to_pack', 'rtd', 'shipped', 'closed'] as const
export type QueueBucket = (typeof QUEUE_BUCKETS)[number]

export const BUCKET_STATUSES: Record<QueueBucket, MarketStatus[]> = {
  new: ['created'],
  to_pack: ['accepted', 'packed'],
  rtd: ['ready_to_dispatch'],
  shipped: ['shipped', 'delivered'],
  closed: ['cancelled', 'rejected', 'returned'],
}

const BUCKET_ORDER: Record<QueueBucket, string> = {
  new: 'mo.accept_by ASC NULLS LAST, mo.placed_at ASC NULLS LAST',
  to_pack: 'mo.dispatch_by ASC NULLS LAST, mo.updated_at ASC',
  rtd: 'mo.updated_at ASC',
  shipped: 'mo.updated_at DESC',
  closed: 'mo.updated_at DESC',
}

const OPEN_RETURNS: ReturnStatus[] = ['initiated', 'in_transit', 'received']

export interface MarketplaceKpis {
  ordersToday: number
  orders7d: number
  sales7d: number
  awaitingAccept: number
  breachingSla: number
  rtdPending: number
  returnsOpen: number
  stockIssues: number
}

export interface MarketplaceEventRow {
  id: string
  received_at: string
  event_type: string | null
  external_order_id: string | null
  status: string
  source: string
  attempts: number
  last_error: string | null
}

export interface MarketplaceOverview {
  kpis: MarketplaceKpis
  counts: Record<QueueBucket, number>
  lastPushAt: string | null
  pendingEvents: number
  failedEvents: number
  recentEvents: MarketplaceEventRow[]
}

const n = (v: unknown) => Number(v ?? 0) || 0

export async function bucketCounts(channel: MarketplaceChannel): Promise<Record<QueueBucket, number>> {
  const rows = await queryMany<{ status: MarketStatus; n: string }>(`SELECT status, count(*) AS n FROM marketplace_orders WHERE channel = $1 GROUP BY status`, [channel])
  const counts = Object.fromEntries(QUEUE_BUCKETS.map(b => [b, 0])) as Record<QueueBucket, number>
  for (const r of rows) {
    const b = QUEUE_BUCKETS.find(k => BUCKET_STATUSES[k].includes(r.status))
    if (b) counts[b] += n(r.n)
  }
  return counts
}

export async function marketplaceOverview(channel: MarketplaceChannel): Promise<MarketplaceOverview> {
  const [k, returns, events, recentEvents, counts] = await Promise.all([
    queryOne<Record<string, string>>(
      `SELECT
         count(*) FILTER (WHERE COALESCE(placed_at, created_at) >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')) AS today,
         count(*) FILTER (WHERE COALESCE(placed_at, created_at) >= now() - interval '7 days') AS week,
         COALESCE(sum(order_total) FILTER (WHERE COALESCE(placed_at, created_at) >= now() - interval '7 days' AND status NOT IN ('cancelled', 'rejected')), 0) AS sales,
         count(*) FILTER (WHERE status = 'created') AS awaiting,
         count(*) FILTER (WHERE (status = 'created' AND accept_by < now()) OR (status IN ('accepted', 'packed') AND dispatch_by < now())) AS breaching,
         count(*) FILTER (WHERE status IN ('accepted', 'packed')) AS rtd_pending,
         count(*) FILTER (WHERE stock_state IN ('short', 'unmatched') AND status NOT IN ('cancelled', 'rejected')) AS stock_issues
       FROM marketplace_orders WHERE channel = $1`,
      [channel]
    ),
    queryOne<{ n: string }>(`SELECT count(*) AS n FROM marketplace_returns WHERE channel = $1 AND status = ANY($2::text[])`, [channel, OPEN_RETURNS]),
    queryOne<{ last_push: string | null; pending: string; failed: string }>(
      `SELECT max(received_at) FILTER (WHERE source = 'push') AS last_push, count(*) FILTER (WHERE status = 'pending') AS pending,
              count(*) FILTER (WHERE status = 'failed') AS failed
         FROM marketplace_webhook_events WHERE channel = $1`,
      [channel]
    ),
    queryMany<MarketplaceEventRow>(
      `SELECT id, received_at, event_type, external_order_id, status, source, attempts, last_error
         FROM marketplace_webhook_events WHERE channel = $1 ORDER BY received_at DESC LIMIT 10`,
      [channel]
    ),
    bucketCounts(channel),
  ])
  return {
    kpis: {
      ordersToday: n(k?.today),
      orders7d: n(k?.week),
      sales7d: n(k?.sales),
      awaitingAccept: n(k?.awaiting),
      breachingSla: n(k?.breaching),
      rtdPending: n(k?.rtd_pending),
      returnsOpen: n(returns?.n),
      stockIssues: n(k?.stock_issues),
    },
    counts,
    lastPushAt: events?.last_push ? new Date(events.last_push).toISOString() : null,
    pendingEvents: n(events?.pending),
    failedEvents: n(events?.failed),
    recentEvents,
  }
}

export interface QueueOrderRow {
  id: string
  external_order_id: string
  order_id: string | null
  order_number: string | null
  status: MarketStatus
  raw_status: string | null
  placed_at: string | null
  accept_by: string | null
  dispatch_by: string | null
  order_total: string | null
  stock_state: string
  stock_note: string | null
  invoice_ref: string | null
  invoice_number: string | null
  po_number: string | null
  ship_city: string | null
  ship_state: string | null
  updated_at: string
  packet_id: string | null
  tracking_number: string | null
  courier: string | null
  tracking_url: string | null
  manifest_id: string | null
  units: number
  items: string | null
  unmatched: boolean
}

export async function queueOrders(channel: MarketplaceChannel, bucket: QueueBucket, q?: string | null, limit = 300): Promise<QueueOrderRow[]> {
  const like = q?.trim() ? `%${q.trim().replace(/[%_\\]/g, m => `\\${m}`)}%` : null
  return queryMany<QueueOrderRow>(
    `SELECT mo.id, mo.external_order_id, mo.order_id, o.order_number, mo.status, mo.raw_status, mo.placed_at, mo.accept_by, mo.dispatch_by,
            mo.order_total, mo.stock_state, mo.stock_note, mo.invoice_ref, o.invoice_number, mo.po_number, mo.ship_city, mo.ship_state, mo.updated_at,
            s.packet_id, s.tracking_number, s.courier, s.tracking_url, s.manifest_id,
            COALESCE(i.units, 0) AS units, i.items, COALESCE(i.unmatched, false) AS unmatched
       FROM marketplace_orders mo
       LEFT JOIN orders o ON o.id = mo.order_id
       LEFT JOIN LATERAL (SELECT packet_id, tracking_number, courier, tracking_url, manifest_id FROM marketplace_shipments ms
                           WHERE ms.marketplace_order_id = mo.id ORDER BY ms.created_at DESC LIMIT 1) s ON true
       LEFT JOIN LATERAL (SELECT count(*)::int AS units, string_agg(DISTINCT COALESCE(NULLIF(title, ''), sku) || COALESCE(' (' || size || ')', ''), ', ') AS items,
                                 bool_or(product_id IS NULL) AS unmatched
                            FROM marketplace_order_items mi WHERE mi.marketplace_order_id = mo.id) i ON true
      WHERE mo.channel = $1 AND mo.status = ANY($2::text[])
        AND ($3::text IS NULL OR mo.external_order_id ILIKE $3 OR o.order_number ILIKE $3 OR s.packet_id ILIKE $3 OR s.tracking_number ILIKE $3)
      ORDER BY ${BUCKET_ORDER[bucket]}
      LIMIT $4`,
    [channel, BUCKET_STATUSES[bucket], like, Math.min(Math.max(limit, 1), 500)]
  )
}

export interface ReturnRow {
  id: string
  external_return_id: string
  return_type: 'customer' | 'rto'
  status: ReturnStatus
  reason: string | null
  line_ids: string[]
  refund_amount: string | null
  tracking_number: string | null
  restocked: boolean
  restocked_at: string | null
  created_at: string
  updated_at: string
  marketplace_order_id: string | null
  external_order_id: string | null
  order_id: string | null
  order_number: string | null
  stock_state: string | null
}

export async function listReturns(channel: MarketplaceChannel, scope: 'open' | 'all' = 'open', limit = 300): Promise<ReturnRow[]> {
  return queryMany<ReturnRow>(
    `SELECT r.id, r.external_return_id, r.return_type, r.status, r.reason, r.line_ids, r.refund_amount, r.tracking_number, r.restocked, r.restocked_at,
            r.created_at, r.updated_at, r.marketplace_order_id, mo.external_order_id, r.order_id, o.order_number, mo.stock_state
       FROM marketplace_returns r
       LEFT JOIN marketplace_orders mo ON mo.id = r.marketplace_order_id
       LEFT JOIN orders o ON o.id = r.order_id
      WHERE r.channel = $1 AND ($2::boolean OR r.status = ANY($3::text[]))
      ORDER BY r.updated_at DESC
      LIMIT $4`,
    [channel, scope === 'all', OPEN_RETURNS, Math.min(Math.max(limit, 1), 500)]
  )
}
