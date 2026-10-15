// GA4 / Google Ads ecommerce events. No-ops without a loaded tag; Consent Mode governs storage.
// item_id is the SKU sanitised exactly like Merchant sync's offerId so Ads can join to the feed.

export const CURRENCY = 'INR'
const PURCHASED_KEY = 'jeffi_ga_purchased'
const PURCHASED_CAP = 50

export interface AnalyticsItem {
  sku: string | null | undefined
  name: string
  price: number
  quantity?: number
  variant?: string | null
}

export interface PurchaseOrder {
  orderNumber: string
  totalAmount: number
  taxAmount?: number
  shippingAmount?: number
  couponCode?: string | null
  items: AnalyticsItem[]
}

type Gtag = (...args: unknown[]) => void

/** Same rule as lib/merchant/mapper.ts buildOfferId. */
export function offerIdFromSku(sku: string): string {
  return sku.replace(/[^a-zA-Z0-9_:.-]/g, '_')
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function toGaItems(items: AnalyticsItem[]) {
  return items
    .filter(i => !!i.sku)
    .map((i, index) => ({
      item_id: offerIdFromSku(String(i.sku)),
      item_name: i.name,
      ...(i.variant ? { item_variant: i.variant } : {}),
      price: round2(Number(i.price) || 0),
      quantity: Number(i.quantity ?? 1) || 1,
      index,
    }))
}

function gtag(): Gtag | null {
  if (typeof window === 'undefined') return null
  const g = (window as unknown as { gtag?: Gtag }).gtag
  return typeof g === 'function' ? g : null
}

function conversionSendTo(): string | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { jeffiAds?: { sendTo?: string | null } }).jeffiAds?.sendTo || null
}

function itemsValue(items: AnalyticsItem[]): number {
  return round2(items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity ?? 1) || 1), 0))
}

function send(event: string, items: AnalyticsItem[], extra: Record<string, unknown> = {}): boolean {
  const g = gtag()
  const gaItems = toGaItems(items)
  if (!g || gaItems.length === 0) return false
  g('event', event, { currency: CURRENCY, value: itemsValue(items), items: gaItems, ...extra })
  return true
}

export const trackViewItem = (item: AnalyticsItem) => send('view_item', [item])
export const trackAddToCart = (item: AnalyticsItem) => send('add_to_cart', [item])
export const trackBeginCheckout = (items: AnalyticsItem[]) => send('begin_checkout', items)

function alreadyTracked(orderNumber: string): boolean {
  try {
    const list = JSON.parse(localStorage.getItem(PURCHASED_KEY) || '[]')
    return Array.isArray(list) && list.includes(orderNumber)
  } catch {
    return false
  }
}

function markTracked(orderNumber: string): void {
  try {
    const raw = JSON.parse(localStorage.getItem(PURCHASED_KEY) || '[]')
    const list: string[] = Array.isArray(raw) ? raw : []
    localStorage.setItem(PURCHASED_KEY, JSON.stringify([...list, orderNumber].slice(-PURCHASED_CAP)))
  } catch {
    /* storage unavailable: at worst a reload re-sends; GA dedupes on transaction_id */
  }
}

/** Fires purchase (+ the Ads conversion when configured) once per order on this browser. */
export function trackPurchase(order: PurchaseOrder): boolean {
  const g = gtag()
  if (!g || !order.orderNumber || alreadyTracked(order.orderNumber)) return false
  const value = round2(Number(order.totalAmount) || 0)
  g('event', 'purchase', {
    transaction_id: order.orderNumber,
    value,
    currency: CURRENCY,
    tax: round2(Number(order.taxAmount) || 0),
    shipping: round2(Number(order.shippingAmount) || 0),
    ...(order.couponCode ? { coupon: order.couponCode } : {}),
    items: toGaItems(order.items),
  })
  const sendTo = conversionSendTo()
  if (sendTo) {
    g('event', 'conversion', { send_to: sendTo, value, currency: CURRENCY, transaction_id: order.orderNumber })
  }
  markTracked(order.orderNumber)
  return true
}
