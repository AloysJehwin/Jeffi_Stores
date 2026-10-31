import { query } from '@/lib/shared/db'
import { CLICK_WINDOW_DAYS, hasClickId, planConversion, type ClickIds, type OrderConversionState, type PlannedRow, type QueueRowLite } from './rules'

// Fills ads_conversion_uploads from order state: order flows call queueAdsConversion, and the upload
// job sweeps recent attributed orders so a missed path or a crash in between is still caught.

export interface Db {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

const STATE_SQL = `SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_mode, o.total_amount,
    o.gclid, o.gbraid, o.wbraid, o.attributed_at, o.created_at, o.delivered_at,
    rr.type AS return_type, rr.returned_value, rr.returned_items
  FROM orders o
  LEFT JOIN LATERAL (
    SELECT r.type,
           (SELECT SUM(i.refund_amount) FROM return_request_items i WHERE i.return_request_id = r.id) AS returned_value,
           (SELECT COUNT(*)::int FROM return_request_items i WHERE i.return_request_id = r.id) AS returned_items
    FROM return_requests r
    WHERE r.order_id = o.id
    ORDER BY (r.status = 'completed') DESC, r.created_at DESC
    LIMIT 1
  ) rr ON TRUE`

const ROWS_SQL = `SELECT order_id, kind, version, value, status, conversion_at, adjustment_at
  FROM ads_conversion_uploads WHERE order_id = ANY($1::uuid[])`

export const SWEEP_LIMIT = 1000
const DAY = 86_400_000

export type QueueResult =
  | { action: 'purchase' | 'retraction' | 'restatement'; value: number }
  | { action: 'none'; reason: string }
  | { action: 'error'; reason: string }

async function insertPlanned(db: Db, o: OrderConversionState, p: PlannedRow): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO ads_conversion_uploads (order_id, order_number, kind, version, gclid, gbraid, wbraid, value,
       click_at, conversion_at, adjustment_at, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (order_id, kind, version) DO NOTHING
     RETURNING id`,
    [
      o.id,
      o.order_number,
      p.kind,
      p.version,
      o.gclid ?? null,
      o.gbraid ?? null,
      o.wbraid ?? null,
      p.value,
      p.clickAt,
      p.conversionAt,
      p.adjustmentAt,
      p.nextAttemptAt,
    ]
  )
  return (r.rowCount ?? r.rows.length) > 0
}

export async function reconcileOrderConversion(db: Db, orderId: string, now = new Date()): Promise<QueueResult> {
  const o = (await db.query(`${STATE_SQL} WHERE o.id = $1`, [orderId])).rows[0] as OrderConversionState | undefined
  if (!o) return { action: 'none', reason: 'not_found' }
  if (!hasClickId(o)) return { action: 'none', reason: 'no_click_id' }
  const rows = (await db.query(ROWS_SQL, [[orderId]])).rows as QueueRowLite[]
  const plan = planConversion(o, rows, now)
  if (!plan) return { action: 'none', reason: 'up_to_date' }
  return (await insertPlanned(db, o, plan)) ? { action: plan.kind, value: plan.value } : { action: 'none', reason: 'exists' }
}

/**
 * Queue what the order's state calls for; never throws into an order flow. `clicks` (the order row or
 * attribution) skips the lookup when it shows no click id.
 */
export async function queueAdsConversion(orderId: string | null | undefined, clicks?: ClickIds | null): Promise<QueueResult> {
  if (!orderId) return { action: 'none', reason: 'no_order' }
  if (clicks && !hasClickId(clicks)) return { action: 'none', reason: 'no_click_id' }
  try {
    return await reconcileOrderConversion({ query: (text, params) => query(text, params) }, orderId)
  } catch (e: any) {
    console.warn('[ads-conversions] could not queue', orderId, e?.message)
    return { action: 'error', reason: String(e?.message ?? e) }
  }
}

/** Reconcile attributed orders from the click window that have not been retracted. */
export async function sweepConversions(db: Db, now = new Date()): Promise<{ checked: number; enqueued: number }> {
  const since = new Date(now.getTime() - (CLICK_WINDOW_DAYS + 5) * DAY)
  const orders = (
    await db.query(
      `${STATE_SQL}
       WHERE (o.gclid IS NOT NULL OR o.gbraid IS NOT NULL OR o.wbraid IS NOT NULL)
         AND o.created_at > $1
         AND NOT EXISTS (SELECT 1 FROM ads_conversion_uploads u WHERE u.order_id = o.id AND u.kind = 'retraction')
       ORDER BY o.updated_at DESC NULLS LAST
       LIMIT ${SWEEP_LIMIT}`,
      [since]
    )
  ).rows as OrderConversionState[]
  if (!orders.length) return { checked: 0, enqueued: 0 }
  const byOrder = new Map<string, QueueRowLite[]>()
  for (const r of (await db.query(ROWS_SQL, [orders.map(o => o.id)])).rows) {
    const list = byOrder.get(r.order_id) ?? []
    list.push(r)
    byOrder.set(r.order_id, list)
  }
  let enqueued = 0
  for (const o of orders) {
    const plan = planConversion(o, byOrder.get(o.id) ?? [], now)
    if (plan && (await insertPlanned(db, o, plan))) enqueued++
  }
  return { checked: orders.length, enqueued }
}
