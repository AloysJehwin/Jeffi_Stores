// GA4 events through Firebase Analytics. Mirror of controller-service lib/client/analytics.ts: same event
// names and item_id (the SKU sanitised like Merchant sync's offerId), so web and app report into one GA4
// property and Ads joins items to the feed. No-ops on a build without the native Firebase module.

import { TurboModuleRegistry } from 'react-native'

type FirebaseAnalytics = typeof import('@react-native-firebase/analytics')
type Instance = ReturnType<FirebaseAnalytics['getAnalytics']>

export const CURRENCY = 'INR'

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

let firebase: FirebaseAnalytics | null | undefined

function run(fn: (m: FirebaseAnalytics, a: Instance) => unknown): void {
  if (firebase === undefined) {
    try {
      // Check for the native module first: on a dev client built before Firebase was added, requiring the
      // JS package throws inside Metro's loader, which LogBox reports even when caught.
      firebase = TurboModuleRegistry.get('NativeRNFBTurboApp')
        ? (require('@react-native-firebase/analytics') as FirebaseAnalytics)
        : null
    } catch {
      firebase = null
    }
  }
  if (!firebase) return
  try {
    const r = fn(firebase, firebase.getAnalytics())
    if (r instanceof Promise) r.catch(() => {})
  } catch {
    // A dev client built before Firebase was added has no native module.
    firebase = null
  }
}

/** Same rule as controller-service lib/merchant/mapper.ts buildOfferId. */
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

function itemsValue(items: AnalyticsItem[]): number {
  return round2(items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity ?? 1) || 1), 0))
}

function params(items: AnalyticsItem[]) {
  const gaItems = toGaItems(items)
  return gaItems.length ? { currency: CURRENCY, value: itemsValue(items), items: gaItems } : null
}

export function trackViewItem(item: AnalyticsItem): void {
  const p = params([item])
  if (p) run((m, a) => m.logEvent(a, 'view_item', p))
}

export function trackAddToCart(item: AnalyticsItem): void {
  const p = params([item])
  if (p) run((m, a) => m.logEvent(a, 'add_to_cart', p))
}

export function trackBeginCheckout(items: AnalyticsItem[]): void {
  const p = params(items)
  if (p) run((m, a) => m.logEvent(a, 'begin_checkout', p))
}

const purchased = new Set<string>()

/** Once per order per app session; GA also dedupes purchases on transaction_id. */
export function trackPurchase(order: PurchaseOrder): void {
  if (!order.orderNumber || purchased.has(order.orderNumber)) return
  purchased.add(order.orderNumber)
  run((m, a) =>
    m.logEvent(a, 'purchase', {
      transaction_id: order.orderNumber,
      value: round2(Number(order.totalAmount) || 0),
      currency: CURRENCY,
      tax: round2(Number(order.taxAmount) || 0),
      shipping: round2(Number(order.shippingAmount) || 0),
      ...(order.couponCode ? { coupon: order.couponCode } : {}),
      items: toGaItems(order.items),
    })
  )
}

/** The route pattern without groups, e.g. "product/[slug]"; the tabs' index is "home". */
export function trackScreen(screen: string): void {
  run((m, a) => m.logScreenView(a, { screen_name: screen, screen_class: screen }))
}
