import { queryOne, withTransaction } from '@/lib/shared/db'
import { restoreOrderStock } from '@/lib/orders/order-stock'
import type { MarketplaceAdapter } from './adapter'
import type { UpsertOutcome } from './upsert'
import { CHANNEL_LABEL, type MarketplaceChannel, type NormalizedOrder, type ReturnStatus } from './types'

// Marketplace returns and RTOs. Events create and refresh the row; the store then marks it
// received / QC passed (stock comes back, once) or QC failed (recorded, no restock). A return the
// store has already received or checked keeps its status when later events arrive.

export const RETURN_ACTIONS = ['receive', 'qc_pass', 'qc_fail'] as const
export type ReturnActionKind = (typeof RETURN_ACTIONS)[number]

const LOCAL_STATUSES: ReturnStatus[] = ['received', 'qc_passed', 'qc_failed', 'closed']
const NEXT: Record<ReturnActionKind, ReturnStatus> = { receive: 'received', qc_pass: 'qc_passed', qc_fail: 'qc_failed' }
const FROM: Record<ReturnActionKind, ReturnStatus[]> = {
  receive: ['initiated', 'in_transit'],
  qc_pass: ['initiated', 'in_transit', 'received'],
  qc_fail: ['initiated', 'in_transit', 'received'],
}

/** Records the return an event reports. A 'returned' order with no return id gets one row of its own
 * (an RTO, or a return the marketplace sent without an id), unless the order already has a return. */
export async function recordMarketplaceReturn(
  order: Pick<NormalizedOrder, 'channel' | 'externalOrderId' | 'rawStatus' | 'returnInfo' | 'raw'>,
  outcome: Pick<UpsertOutcome, 'marketplaceOrderId' | 'orderId' | 'status' | 'applied'>
): Promise<string | null> {
  let info = order.returnInfo ?? null
  if (!info) {
    if (!outcome.applied || outcome.status !== 'returned') return null
    const has = await queryOne(`SELECT 1 FROM marketplace_returns WHERE marketplace_order_id = $1 LIMIT 1`, [outcome.marketplaceOrderId])
    if (has) return null
    const rto = /rto/i.test(order.rawStatus ?? '') || !order.rawStatus
    info = { externalReturnId: `${rto ? 'RTO' : 'RET'}-${order.externalOrderId}`, type: rto ? 'rto' : 'customer', status: 'initiated' }
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO marketplace_returns (channel, external_return_id, marketplace_order_id, order_id, return_type, status, reason, line_ids, refund_amount, tracking_number, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11::jsonb)
     ON CONFLICT (channel, external_return_id) DO UPDATE SET
       marketplace_order_id = COALESCE(marketplace_returns.marketplace_order_id, EXCLUDED.marketplace_order_id),
       order_id = COALESCE(marketplace_returns.order_id, EXCLUDED.order_id),
       status = CASE WHEN marketplace_returns.status = ANY($12::text[]) THEN marketplace_returns.status ELSE EXCLUDED.status END,
       reason = COALESCE(EXCLUDED.reason, marketplace_returns.reason),
       line_ids = CASE WHEN cardinality(EXCLUDED.line_ids) > 0 THEN EXCLUDED.line_ids ELSE marketplace_returns.line_ids END,
       refund_amount = COALESCE(EXCLUDED.refund_amount, marketplace_returns.refund_amount),
       tracking_number = COALESCE(EXCLUDED.tracking_number, marketplace_returns.tracking_number),
       raw = EXCLUDED.raw, updated_at = now()
     RETURNING id`,
    [
      order.channel,
      info.externalReturnId,
      outcome.marketplaceOrderId,
      outcome.orderId || null,
      info.type ?? 'customer',
      info.status ?? 'initiated',
      info.reason ?? null,
      info.lineIds ?? [],
      info.refundAmount ?? null,
      info.trackingNumber ?? null,
      JSON.stringify(order.raw ?? {}),
      LOCAL_STATUSES,
    ]
  )
  return row?.id ?? null
}

export interface ReturnTarget {
  id: string
  channel: MarketplaceChannel
  external_return_id: string
  status: ReturnStatus
  restocked: boolean
  line_ids: string[]
  marketplace_order_id: string | null
  order_id: string | null
}

export async function loadReturn(channel: MarketplaceChannel, id: string): Promise<ReturnTarget | null> {
  return queryOne<ReturnTarget>(
    `SELECT id, channel, external_return_id, status, restocked, line_ids, marketplace_order_id, order_id
       FROM marketplace_returns WHERE channel = $1 AND id = $2`,
    [channel, id]
  )
}

export function returnActionProblem(r: Pick<ReturnTarget, 'status'>, action: ReturnActionKind): string | null {
  if (FROM[action].includes(r.status)) return null
  return `This return is ${r.status.replace(/_/g, ' ')}; it can't be marked ${NEXT[action].replace(/_/g, ' ')}.`
}

export interface ReturnActionOutcome {
  status: ReturnStatus
  restocked: boolean
  message: string
}

/** Tells the marketplace (where it has the API), then records the step; QC passed restocks once.
 * Stock comes back for a whole-order return of an order whose stock was deducted; a partial return
 * is recorded without restocking (the order's deduction can't be split by line). */
export async function applyReturnAction(r: ReturnTarget, action: ReturnActionKind, note: string | null, adapter: MarketplaceAdapter | null): Promise<ReturnActionOutcome> {
  if (adapter?.returnAction) {
    const res = await adapter.returnAction({ externalReturnId: r.external_return_id, action, note: note ?? undefined })
    if (!res.ok) throw new Error(res.message || `${CHANNEL_LABEL[r.channel]} did not accept this.`)
  }
  return withTransaction(async db => {
    const cur = (await db.query<ReturnTarget>(`SELECT id, status, restocked, line_ids, marketplace_order_id, order_id FROM marketplace_returns WHERE id = $1 FOR UPDATE`, [r.id])).rows[0]
    if (!cur) throw new Error('Return not found')
    const problem = returnActionProblem(cur, action)
    if (problem) throw new Error(problem)
    let restocked = cur.restocked
    let message = action === 'qc_fail' ? 'Recorded as QC failed; stock was not restored.' : action === 'qc_pass' ? 'QC passed.' : 'Marked received.'
    let whole = true
    if (cur.marketplace_order_id) {
      const lines = (await db.query<{ line_id: string }>(`SELECT DISTINCT external_line_id AS line_id FROM marketplace_order_items WHERE marketplace_order_id = $1`, [cur.marketplace_order_id])).rows
      const returned = new Set(cur.line_ids ?? [])
      whole = !returned.size || lines.every(l => returned.has(l.line_id))
    }
    if (action === 'qc_pass' && !restocked) {
      const mo = cur.marketplace_order_id
        ? (await db.query<{ stock_state: string }>(`SELECT stock_state FROM marketplace_orders WHERE id = $1 FOR UPDATE`, [cur.marketplace_order_id])).rows[0]
        : null
      if (!cur.order_id || !mo) message = 'QC passed. This return is not linked to an order, so stock was not restored.'
      else if (mo.stock_state !== 'deducted') message = 'QC passed. Stock was not deducted for this order, so nothing was restored.'
      else if (!whole) message = 'QC passed. This return covers only part of the order: adjust stock for the returned units on the product.'
      else {
        await restoreOrderStock(cur.order_id, db)
        await db.query(`UPDATE marketplace_orders SET stock_state = 'restored', updated_at = now() WHERE id = $1`, [cur.marketplace_order_id])
        restocked = true
        message = 'QC passed; stock restored.'
      }
    }
    const status = NEXT[action]
    await db.query(
      `UPDATE marketplace_returns SET status = $2, restocked = $3, restocked_at = CASE WHEN $3 AND restocked_at IS NULL THEN now() ELSE restocked_at END,
         raw = raw || jsonb_build_object('qc', jsonb_build_object('action', $4::text, 'note', $5::text, 'at', now())), updated_at = now()
       WHERE id = $1`,
      [cur.id, status, restocked, action, note]
    )
    if (whole && cur.order_id && action !== 'receive') {
      await db.query(`UPDATE orders SET status = 'returned', updated_at = now() WHERE id = $1 AND status = 'return_requested'`, [cur.order_id])
    }
    return { status, restocked, message }
  })
}
