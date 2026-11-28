import { queryMany, queryOne } from '@/lib/shared/db'

// Orders looked up by a phone number: the order's own customer_phone, or the phone of the account that placed it.
// Phones sit in the DB with or without +91, so every comparison is on the last 10 digits.

export const phone10 = (p: string | null | undefined): string => String(p ?? '').replace(/\D/g, '').slice(-10)

const DIGITS = (col: string) => `right(regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g'), 10)`
export const phoneMatchSql = (col: string, param: string) => `${DIGITS(col)} = ${param}`

export interface PhoneOrder {
  id: string
  order_number: string
  user_id: string | null
  status: string
  payment_status: string | null
  payment_mode: string | null
  total_amount: string
  created_at: string | Date
  delivered_at: string | Date | null
  awb_number: string | null
  shipment_status: string | null
  estimated_delivery_date: string | null
  courier_edd: string | null
  payment_link_status: string | null
  admin_notes: string | null
}

export interface PhoneOrderItem {
  product_id: string | null
  product_name: string
  slug: string | null
  quantity: number
  unit_price: number
}

const COLS = `o.id::text, o.order_number, o.user_id::text, o.status, o.payment_status, o.payment_mode, o.total_amount::text,
  o.created_at, COALESCE(o.delivered_at, o.granted_at) AS delivered_at, o.awb_number, o.shipment_status,
  o.estimated_delivery_date::text, o.courier_edd::text, o.payment_link_status, o.admin_notes`

const OWNED = `(${DIGITS('o.customer_phone')} = $1 OR o.user_id IN (SELECT id FROM users WHERE ${DIGITS('phone')} = $1))`

/** The phone's most recent orders, newest first. */
export async function findOrdersByPhone(phone: string, limit = 5): Promise<PhoneOrder[]> {
  const p = phone10(phone)
  if (p.length < 10) return []
  return queryMany<PhoneOrder>(
    `SELECT ${COLS} FROM orders o WHERE ${OWNED} AND o.draft_of_id IS NULL ORDER BY o.created_at DESC LIMIT $2`,
    [p, Math.min(Math.max(limit, 1), 20)]
  )
}

/** One order by number (a leading # is ignored) or id, only when it belongs to this phone. */
export async function getOrderForPhone(ref: string, phone: string): Promise<PhoneOrder | null> {
  const p = phone10(phone)
  const key = String(ref ?? '').trim().replace(/^#/, '')
  if (p.length < 10 || !key) return null
  return queryOne<PhoneOrder>(
    `SELECT ${COLS} FROM orders o WHERE ${OWNED} AND (o.order_number = $2 OR o.id::text = $2) LIMIT 1`,
    [p, key]
  )
}

export async function orderItemsOf(orderId: string): Promise<PhoneOrderItem[]> {
  return queryMany<PhoneOrderItem>(
    `SELECT oi.product_id::text, oi.product_name, p.slug, oi.quantity::float, oi.unit_price::float
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1::uuid ORDER BY oi.created_at, oi.id`,
    [orderId]
  )
}
