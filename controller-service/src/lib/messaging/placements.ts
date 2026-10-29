// Where library templates are offered. A template's tags say so: 'page:<page>', and on a page with
// scenarios also 'scenario:<page>.<id>'. The order page shows a scenario only when the order is in a
// state it suits. Client-safe.

export type PageKey = 'order' | 'customer'

export type ReplyKind = 'order_delay' | 'out_of_stock' | 'payment_failed'

export interface PlacementScenario {
  id: string
  label: string
  /** The standard template for it. */
  slug: string
  /** Order states it suits; status and payment both have to match when both are given. Omitted = any. */
  when?: { status?: string[]; payment?: string[] }
  /** The customer's reply is read and acted on (see lib/replies). */
  reply?: ReplyKind
  /** Ask which order item it is about. */
  pickItem?: boolean
}

const OPEN = ['pending', 'confirmed', 'processing']
const IN_TRANSIT = ['shipped', 'out_for_delivery']
const LIVE = [...OPEN, ...IN_TRANSIT, 'delivered']

export const PAGES: Record<PageKey, { label: string; hint: string; scenarios: PlacementScenario[] }> = {
  order: {
    label: 'Order page',
    hint: 'Email the customer panel on an order',
    scenarios: [
      { id: 'delay_processing', label: 'Processing delay', slug: 'order/delay-processing', when: { status: OPEN }, reply: 'order_delay' },
      { id: 'quality_check', label: 'Quality-check hold', slug: 'order/quality-check', when: { status: ['confirmed', 'processing'] } },
      { id: 'out_of_stock', label: 'Item unavailable', slug: 'order/out-of-stock', when: { status: OPEN }, reply: 'out_of_stock', pickItem: true },
      { id: 'address_confirm', label: 'Confirm the address', slug: 'order/address-confirm', when: { status: OPEN } },
      { id: 'payment_reminder', label: 'Payment reminder', slug: 'order/payment-reminder', when: { status: LIVE, payment: ['unpaid', 'failed'] }, reply: 'payment_failed' },
      { id: 'delay_shipping', label: 'Shipping delay', slug: 'order/delay-shipping', when: { status: IN_TRANSIT }, reply: 'order_delay' },
      { id: 'delivery_attempt_failed', label: 'Delivery attempt failed', slug: 'order/delivery-attempt-failed', when: { status: IN_TRANSIT } },
      { id: 'delivered_checkin', label: 'Delivered check-in', slug: 'order/delivered-checkin', when: { status: ['delivered'] } },
      { id: 'refund_update', label: 'Refund update', slug: 'order/refund-update', when: { status: ['cancelled', 'returned', 'return_received'] } },
    ],
  },
  customer: {
    label: 'Customer page',
    hint: 'Email panel on a customer',
    scenarios: [],
  },
}

export const pageTag = (page: PageKey) => `page:${page}`
export const scenarioTag = (page: PageKey, id: string) => `scenario:${page}.${id}`

/** The order-page scenario a template is tagged with, if any. */
export function scenarioOf(page: PageKey, tags: string[] | null | undefined): PlacementScenario | null {
  const prefix = `scenario:${page}.`
  const id = (tags ?? []).find(t => t.startsWith(prefix))?.slice(prefix.length)
  return PAGES[page].scenarios.find(s => s.id === id) ?? null
}

export function scenarioFits(s: PlacementScenario | null, order: { status: string; payment_status: string | null }): boolean {
  if (!s?.when) return true
  const { status, payment } = s.when
  return (!status || status.includes(order.status)) && (!payment || payment.includes(order.payment_status ?? ''))
}

/** Tags for the editor's "Show on" choice: the pages, plus the order scenario. */
export function placementTags(pages: PageKey[], orderScenario: string | null): string[] {
  return [...pages.map(pageTag), ...(pages.includes('order') && orderScenario ? [scenarioTag('order', orderScenario)] : [])]
}

export function pagesOf(tags: string[] | null | undefined): PageKey[] {
  return (Object.keys(PAGES) as PageKey[]).filter(p => (tags ?? []).includes(pageTag(p)))
}
