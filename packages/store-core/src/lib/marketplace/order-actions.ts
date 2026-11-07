import { query, queryMany } from '@/lib/shared/db'
import type { MarketplaceAdapter, OrderActionInput } from './adapter'
import { ACTION_STATUS } from './mapping'
import { pushStockAfterOrderEvent } from './stock'
import { upsertMarketplaceOrder, type UpsertOutcome } from './upsert'
import { CHANNEL_LABEL, type MarketplaceChannel, type MarketStatus, type ShipmentInfo } from './types'

// Accept / reject / pack / ready-to-dispatch from the orders queue: the marketplace is told first,
// then the result goes through the same upsert as a pushed event (stock moves with it, RTD tracking
// lands in marketplace_shipments).

export const QUEUE_ACTIONS = ['accept', 'reject', 'pack', 'ready_to_dispatch'] as const
export type QueueAction = (typeof QUEUE_ACTIONS)[number]

const FROM: Record<QueueAction, MarketStatus[]> = {
  accept: ['created'],
  reject: ['created', 'accepted'],
  pack: ['accepted'],
  ready_to_dispatch: ['accepted', 'packed'],
}

export const ACTION_VERB: Record<QueueAction, string> = { accept: 'Accepted', reject: 'Rejected', pack: 'Packed', ready_to_dispatch: 'Marked ready to dispatch' }

export interface ActionTarget {
  id: string
  channel: MarketplaceChannel
  external_order_id: string
  order_id: string | null
  status: MarketStatus
  currency: string | null
  raw: unknown
  line_ids: string[]
}

export async function loadActionTargets(channel: MarketplaceChannel, ids: string[]): Promise<ActionTarget[]> {
  if (!ids.length) return []
  return queryMany<ActionTarget>(
    `SELECT mo.id, mo.channel, mo.external_order_id, mo.order_id, mo.status, mo.currency, mo.raw,
            COALESCE(array_agg(DISTINCT i.external_line_id) FILTER (WHERE i.id IS NOT NULL AND COALESCE(i.status, '') NOT IN ('cancelled', 'rejected')), '{}') AS line_ids
       FROM marketplace_orders mo LEFT JOIN marketplace_order_items i ON i.marketplace_order_id = mo.id
      WHERE mo.channel = $1 AND mo.id = ANY($2::uuid[])
      GROUP BY mo.id`,
    [channel, ids]
  )
}

export function actionProblem(t: Pick<ActionTarget, 'status'>, action: QueueAction, reason?: string | null): string | null {
  if (action === 'reject' && (reason ?? '').trim().length < 3) return 'Give a reason for rejecting.'
  if (FROM[action].includes(t.status)) return null
  return `This order is ${t.status.replace(/_/g, ' ')}; it can't be ${ACTION_VERB[action].toLowerCase()} now.`
}

export interface ActionResult extends UpsertOutcome {
  shipment: ShipmentInfo | null
}

/** Sends the action to the marketplace, then records its result as an order event. */
export async function runOrderAction(
  adapter: MarketplaceAdapter,
  t: ActionTarget,
  input: { action: QueueAction; reason?: string | null; packet?: OrderActionInput['packet'] },
  now = new Date()
): Promise<ActionResult> {
  const reason = input.reason?.trim() || undefined
  const res = await adapter.orderAction({
    action: input.action,
    externalOrderId: t.external_order_id,
    lineIds: t.line_ids.length ? t.line_ids : undefined,
    reason,
    packet: input.packet,
  })
  if (!res.ok) throw new Error(res.message || `${CHANNEL_LABEL[t.channel]} did not accept the change.`)
  const shipment = res.shipment && (res.shipment.packetId || res.shipment.trackingNumber) ? res.shipment : null
  const outcome = await upsertMarketplaceOrder({
    channel: t.channel,
    externalOrderId: t.external_order_id,
    status: res.status ?? ACTION_STATUS[input.action],
    rawStatus: `admin:${input.action}`,
    eventAt: now.toISOString(),
    currency: t.currency,
    shipment,
    lines: [],
    raw: t.raw ?? {},
  })
  if (outcome.stock === 'deduct' || outcome.stock === 'restore') pushStockAfterOrderEvent()
  if (input.action === 'reject' && outcome.orderId) {
    await query(`UPDATE orders SET admin_notes = concat_ws(E'\\n', NULLIF(admin_notes, ''), $2::text), updated_at = now() WHERE id = $1`, [
      outcome.orderId,
      `Rejected on ${CHANNEL_LABEL[t.channel]}: ${reason}`.slice(0, 500),
    ])
  }
  return { ...outcome, shipment }
}
