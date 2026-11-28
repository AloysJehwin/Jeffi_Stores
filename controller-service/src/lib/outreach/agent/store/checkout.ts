import { queryMany, queryOne } from '@/lib/shared/db'
import { getOrderForPhone, orderItemsOf, phoneMatchSql, phone10 } from '@/lib/orders/by-phone'
import type { CheckoutRef } from '../types'
import { iso, itemsShort, rupees } from './format'

export interface CheckoutItem {
  productId: string | null
  name: string
  slug: string | null
  quantity: number
  price: number
}

export interface LoadedCheckout {
  ref: CheckoutRef
  items: CheckoutItem[]
  userId: string | null
  orderId: string | null
  /** The customer has placed an order since this checkout (nothing left to recover). */
  orderedSince: boolean
  buyNow: boolean
}

const KEY = /^(cart|order|intent):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

async function cartItems(userId: string): Promise<(CheckoutItem & { at: Date })[]> {
  const rows = await queryMany<{ product_id: string; name: string; slug: string | null; quantity: number; price: number; updated_at: Date }>(
    `SELECT p.id::text AS product_id, p.name, p.slug, ci.quantity::float AS quantity, ci.price_at_addition::float AS price, ci.updated_at
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.user_id = $1::uuid AND ci.saved_for_later = FALSE ORDER BY ci.updated_at DESC LIMIT 10`,
    [userId]
  )
  return rows.map(r => ({ productId: r.product_id, name: r.name, slug: r.slug, quantity: r.quantity, price: r.price, at: r.updated_at }))
}

async function ownedUser(userId: string, phone: string): Promise<boolean> {
  const p = phone10(phone)
  if (p.length < 10) return false
  return !!(await queryOne(`SELECT 1 FROM users WHERE id = $1::uuid AND ${phoneMatchSql('phone', '$2')}`, [userId, p]))
}

async function orderedAfter(userId: string | null, at: Date | string): Promise<boolean> {
  if (!userId) return false
  return !!(await queryOne(`SELECT 1 FROM orders WHERE user_id = $1::uuid AND created_at > $2 AND status <> 'cancelled' AND draft_of_id IS NULL LIMIT 1`, [userId, at]))
}

const sum = (items: CheckoutItem[]) => items.reduce((t, i) => t + i.price * i.quantity, 0)

function build(key: string, kind: CheckoutRef['kind'], items: CheckoutItem[], total: number, at: Date | string): CheckoutRef {
  return { key, kind, total: rupees(total), itemCount: items.length, itemsShort: itemsShort(items.map(i => i.name)), at: iso(at) ?? '' }
}

/**
 * A checkout the job refers to (cart:<userId>, order:<orderId> or intent:<id>), only when it belongs to this phone.
 * An abandoned cart is read live from the cart; a failed checkout from its order or its payment attempt.
 */
export async function loadCheckout(key: string, phone: string): Promise<LoadedCheckout | null> {
  const m = KEY.exec(String(key ?? '').trim())
  if (!m) return null
  const kind = m[1].toLowerCase()
  const id = m[2].toLowerCase()

  if (kind === 'cart') {
    if (!(await ownedUser(id, phone))) return null
    const items = await cartItems(id)
    if (!items.length) return null
    const at = items.reduce((a, i) => (i.at > a ? i.at : a), items[0].at)
    return { ref: build(`cart:${id}`, 'cart', items, sum(items), at), items, userId: id, orderId: null, orderedSince: await orderedAfter(id, at), buyNow: false }
  }

  if (kind === 'order') {
    const order = await getOrderForPhone(id, phone)
    if (!order) return null
    const rows = await orderItemsOf(order.id)
    const items = rows.map(i => ({ productId: i.product_id, name: i.product_name, slug: i.slug, quantity: i.quantity, price: i.unit_price }))
    if (!items.length) return null
    return { ref: build(`order:${order.id}`, 'checkout', items, Number(order.total_amount), order.created_at), items, userId: order.user_id, orderId: order.id, orderedSince: await orderedAfter(order.user_id, order.created_at), buyNow: false }
  }

  const intent = await queryOne<{ id: string; user_id: string; amount_paise: number; draft_token: string; created_at: Date }>(
    `SELECT id::text, user_id::text, amount_paise, draft_token, created_at FROM pending_payment_intents WHERE id = $1::uuid`,
    [id]
  )
  if (!intent || !(await ownedUser(intent.user_id, phone))) return null
  const { verifyDraftToken } = await import('@/lib/orders/order-draft')
  const draft = await verifyDraftToken(intent.draft_token, { ignoreExpiry: true }).catch(() => null)
  let items: CheckoutItem[] = []
  let buyNow = false
  if (draft?.mode === 'buyNow' && draft.buyNowItem) {
    const b = draft.buyNowItem
    const p = await queryOne<{ id: string; name: string; slug: string | null }>(`SELECT id::text, name, slug FROM products WHERE id = $1::uuid`, [b.productId])
    if (p) items = [{ productId: p.id, name: p.name, slug: p.slug, quantity: Number(b.qty) || 1, price: Number(b.price) || 0 }]
    buyNow = true
  } else items = await cartItems(intent.user_id)
  if (!items.length) return null
  return { ref: build(`intent:${intent.id}`, 'checkout', items, intent.amount_paise / 100, intent.created_at), items, userId: intent.user_id, orderId: null, orderedSince: await orderedAfter(intent.user_id, intent.created_at), buyNow }
}

/** Where the customer picks the purchase back up: the product for a buy-now attempt, else the cart. */
export async function checkoutUrl(co: LoadedCheckout): Promise<string> {
  const { storeBaseUrlAsync } = await import('@/lib/catalog/brand')
  const base = (await storeBaseUrlAsync()).replace(/\/$/, '')
  const slug = co.items[0]?.slug
  return co.buyNow && slug ? `${base}/products/${encodeURIComponent(slug)}` : `${base}/cart`
}

export async function productLink(slug: string): Promise<string> {
  const { productUrl } = await import('@/lib/shared/customer-links')
  return productUrl(slug)
}

export const checkoutLines = (items: CheckoutItem[]) => items.slice(0, 8).map(i => ({ name: i.name, quantity: i.quantity, price: rupees(i.price) }))

/** Courier serviceability and the estimated delivery date for a pincode, from the store's own delivery settings. */
export async function checkDelivery(pincode: string): Promise<Record<string, unknown>> {
  const pin = String(pincode ?? '').replace(/\D/g, '')
  const [{ checkPincodeServiceability }, { computeEddBreakdown }, { getBusinessValues }] = await Promise.all([
    import('@/lib/shipping/delhivery'),
    import('@/lib/shipping/edd'),
    import('@/lib/catalog/site-controls'),
  ])
  const svc = await checkPincodeServiceability(pin)
  if (!svc.serviceable) return { pincode: pin, serviceable: false, ...(svc.error ? { note: svc.error } : {}) }
  const store = await getBusinessValues().catch(() => null)
  const edd = computeEddBreakdown({ pin, store })
  return { pincode: pin, serviceable: true, cod: svc.cod, prepaid: svc.prepaid, district: svc.district, state: svc.state, estimatedDelivery: edd.edd, daysToDeliver: edd.totalDays }
}

export class PaymentLinkRefusal extends Error {
  constructor(public code: string) {
    super(code)
  }
}

const PAYABLE = new Set(['unpaid', 'pending', 'failed'])

/** Throws PaymentLinkRefusal unless this is the job's own unpaid, uncancelled, non-COD order. */
export function assertPayable(o: { status: string; payment_status: string | null; payment_mode: string | null }): void {
  if (o.payment_mode === 'cod') throw new PaymentLinkRefusal('cod_order')
  if (o.status === 'cancelled' || o.status === 'refunded') throw new PaymentLinkRefusal('order_cancelled')
  if (!PAYABLE.has(String(o.payment_status ?? 'unpaid'))) throw new PaymentLinkRefusal('not_unpaid')
}

/** A Razorpay payment link for the order (a live one is reused). notify: Razorpay also texts the customer; we send our own. */
export async function paymentLinkFor(o: { id: string; status: string; payment_status: string | null; payment_mode: string | null }, notify = false) {
  assertPayable(o)
  const { createOrderPaymentLink } = await import('@/lib/payments/payment-link')
  return createOrderPaymentLink(o.id, 48, notify)
}
