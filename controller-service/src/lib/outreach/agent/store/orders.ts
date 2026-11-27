import { query } from '@/lib/shared/db'
import { findOrdersByPhone, getOrderForPhone, orderItemsOf, type PhoneOrder, type PhoneOrderItem } from '@/lib/orders/by-phone'
import type { OrderRef } from '../types'
import { iso, itemsShort, rupees } from './format'
import { createStaffTask } from './support'

export type { PhoneOrder, PhoneOrderItem }

export function toOrderRef(o: PhoneOrder, items: PhoneOrderItem[]): OrderRef {
  return {
    id: o.id,
    number: o.order_number,
    status: o.status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_mode,
    total: rupees(o.total_amount),
    itemCount: items.length,
    itemsShort: itemsShort(items.map(i => i.product_name)),
    placedAt: iso(o.created_at) ?? '',
    deliveredAt: iso(o.delivered_at),
    hasTracking: !!o.awb_number,
  }
}

/** The order (number, #number or id) when it belongs to this phone, with its items and safe summary. */
export async function loadOrder(ref: string, phone: string): Promise<{ order: PhoneOrder; items: PhoneOrderItem[]; ref: OrderRef } | null> {
  const order = await getOrderForPhone(ref, phone)
  if (!order) return null
  const items = await orderItemsOf(order.id)
  return { order, items, ref: toOrderRef(order, items) }
}

/** Safe lines for the LLM: no address, email or phone. */
export const itemLines = (items: PhoneOrderItem[]) => items.slice(0, 10).map(i => ({ name: i.product_name, quantity: i.quantity, price: rupees(i.unit_price) }))

export async function recentOrders(phone: string, limit = 5) {
  const orders = await findOrdersByPhone(phone, limit)
  return orders.map(o => ({
    number: o.order_number,
    status: o.status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_mode,
    total: rupees(o.total_amount),
    placedAt: iso(o.created_at),
    deliveredAt: iso(o.delivered_at),
    tracked: !!o.awb_number,
  }))
}

export interface ShipmentView {
  shipped: boolean
  status: string
  shipmentStatus: string | null
  expectedDelivery: string | null
  lastUpdate: string | null
  recentScans: { at: string | null; where: string | null; what: string | null }[]
}

/** Live Delhivery status for the order, or the stored status and promised date when it has no AWB yet. */
export async function trackShipment(o: PhoneOrder): Promise<ShipmentView | { error: string }> {
  const promised = o.courier_edd ?? o.estimated_delivery_date
  if (!o.awb_number) return { shipped: false, status: o.status, shipmentStatus: o.shipment_status, expectedDelivery: promised, lastUpdate: null, recentScans: [] }
  const { trackOrder, TrackingError } = await import('@/lib/shipping/track')
  try {
    const t = await trackOrder({ id: o.id, awb_number: o.awb_number, shipment_status: o.shipment_status })
    if (!t) return { shipped: true, status: o.status, shipmentStatus: o.shipment_status, expectedDelivery: promised, lastUpdate: null, recentScans: [] }
    return {
      shipped: true,
      status: t.status ?? o.status,
      shipmentStatus: t.shipmentStatus,
      expectedDelivery: t.expectedDelivery ?? promised,
      lastUpdate: iso(t.statusDateTime),
      recentScans: t.scans.slice(0, 3).map(s => ({ at: iso(s.date), where: s.location, what: s.activity })),
    }
  } catch (e) {
    return { error: e instanceof TrackingError ? 'tracking_unavailable' : 'failed' }
  }
}

const CLOSED = new Set(['cancelled', 'refunded', 'delivered', 'granted'])

/**
 * The customer confirmed (or declined) a COD order on a call. Recorded as a line in the order's admin notes (what the
 * team reads on the order) and, on a decline, a staff task. Never changes the order's status or payment.
 */
export async function recordCodConfirmation(
  o: PhoneOrder,
  a: { confirmed: boolean; note?: string; jobId: string; userId: string | null }
): Promise<{ ok: true; alreadyRecorded: boolean } | { ok: false; error: string }> {
  if (o.payment_mode !== 'cod') return { ok: false, error: 'not_cod' }
  if (CLOSED.has(o.status)) return { ok: false, error: 'order_closed' }
  const verdict = a.confirmed ? 'confirmed' : 'declined'
  const marker = `[outreach ${a.jobId} ${verdict}]`
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const line = `${marker} COD ${verdict} by the customer on an outreach call (${when} IST)${a.note ? `: ${a.note.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`
  const r = await query(
    `UPDATE orders SET admin_notes = CASE WHEN COALESCE(admin_notes, '') = '' THEN $2::text ELSE admin_notes || E'\\n' || $2::text END
      WHERE id = $1::uuid AND position($3::text in COALESCE(admin_notes, '')) = 0`,
    [o.id, line, marker]
  )
  const fresh = (r.rowCount ?? 0) > 0
  if (!a.confirmed && fresh) {
    await createStaffTask({
      userId: a.userId ?? o.user_id,
      key: `cod:${o.id}`,
      title: `COD order #${o.order_number} declined on the confirmation call`,
      description: `The customer said they do not want this COD order${a.note ? `: ${a.note}` : ''}. Review before it is dispatched; nothing was cancelled automatically.`,
      priority: 'high',
      dueInDays: 1,
    })
  }
  return { ok: true, alreadyRecorded: !fresh }
}
