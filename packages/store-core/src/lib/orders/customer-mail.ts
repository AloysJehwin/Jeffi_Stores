import { queryMany, queryOne } from '@/lib/shared/db'
import { orderUrl } from '@/lib/shared/customer-links'
import { resolveTemplateVariables } from '@/lib/templates/variables'
import { findTokenKeys } from '@/lib/templates/variables-shared'
import { listPageTemplates } from '@/lib/messaging/library'
import { PAGES, scenarioFits, scenarioOf, type PlacementScenario } from '@/lib/messaging/placements'

// The order page's "Email the customer" panel: the templates offered for an order, the order details
// they fill in, and the tokens still unfilled before a send.

type OrderRow = {
  id: string
  order_number: string
  status: string
  payment_status: string | null
  user_id: string | null
  created_at: string
  total_amount: string
  customer_name: string | null
  customer_email: string | null
  u_email: string | null
  u_first: string | null
  u_last: string | null
  tracking_url: string | null
  awb_number: string | null
  tracking_number: string | null
  delhivery_shipment_id: string | null
  edd: string | null
  address: Record<string, string | null> | null
  payment_link_url: string | null
  payment_link_status: string | null
  refund: string | null
}

const loadOrder = (id: string) =>
  queryOne<OrderRow>(
    `SELECT o.id, o.order_number, o.status, o.payment_status, o.user_id::text, o.created_at, o.total_amount,
            o.customer_name, o.customer_email, u.email AS u_email, u.first_name AS u_first, u.last_name AS u_last,
            o.tracking_url, o.awb_number, o.tracking_number, o.delhivery_shipment_id::text,
            COALESCE(o.courier_edd, o.estimated_delivery_date)::text AS edd, o.shipping_address_snapshot AS address,
            o.payment_link_url, o.payment_link_status,
            (SELECT SUM(ri.refund_amount) FROM return_request_items ri JOIN return_requests rr ON rr.id = ri.return_request_id
              WHERE rr.order_id = o.id)::text AS refund
       FROM orders o LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1`,
    [id]
  )

const loadItems = (id: string) =>
  queryMany<{ id: string; product_name: string; variant_name: string | null; quantity: number }>(
    `SELECT id::text, product_name, variant_name, quantity FROM order_items WHERE order_id = $1 ORDER BY created_at`,
    [id]
  )

const inr = (n: string | number | null) =>
  n == null || n === '' ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : ''
const itemName = (i: { product_name: string; variant_name: string | null }) => [i.product_name, i.variant_name].filter(Boolean).join(' - ')

function recipient(o: OrderRow) {
  const first = o.u_first || o.customer_name?.split(' ')[0] || ''
  const last = o.u_first ? o.u_last || '' : o.customer_name?.split(' ').slice(1).join(' ') || ''
  return { email: o.u_email || o.customer_email || '', first, last, name: [first, last].filter(Boolean).join(' ') || o.customer_name || '' }
}

export interface OrderMailTemplate {
  slug: string
  name: string
  subject: string
  preheader: string
  body: string
  scenario: Pick<PlacementScenario, 'id' | 'label' | 'reply' | 'pickItem'> | null
  /** The order is in a state the scenario suits (always true without a scenario). */
  fits: boolean
}

/** The order-page templates for this order, the ones that suit its state first. */
export async function orderMailTemplates(orderId: string) {
  const [o, items, list] = await Promise.all([loadOrder(orderId), loadItems(orderId), listPageTemplates('page:order')])
  if (!o) return null
  const rank = (s: PlacementScenario | null) => (s ? PAGES.order.scenarios.indexOf(s) : 99)
  const templates: OrderMailTemplate[] = list
    .map(t => {
      const s = scenarioOf('order', t.tags)
      return {
        slug: t.slug,
        name: t.name,
        subject: t.subject,
        preheader: t.preheader,
        body: t.body,
        scenario: s ? { id: s.id, label: s.label, reply: s.reply, pickItem: s.pickItem } : null,
        fits: scenarioFits(s, o),
        rank: rank(s),
      }
    })
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.rank - b.rank || a.name.localeCompare(b.name))
    .map(({ rank: _rank, ...t }) => t)
  return {
    order: { status: o.status, paymentStatus: o.payment_status, email: recipient(o).email },
    items: items.map(i => ({ id: i.id, name: itemName(i), quantity: i.quantity })),
    templates,
  }
}

/**
 * The values an order-page email fills in: the store and customer ones plus the order's own. A token
 * whose value is empty here (no tracking yet, no item picked) is reported as unfilled. The payment link
 * is only created for a real send; a preview shows the current one or says it will be created.
 */
export async function orderMailVars(orderId: string, opts: { itemId?: string | null; createPaymentLink?: boolean; usesPaymentLink?: boolean } = {}) {
  const [o, items] = await Promise.all([loadOrder(orderId), loadItems(orderId)])
  if (!o) return null
  const r = recipient(o)
  const item = opts.itemId ? items.find(i => i.id === opts.itemId) : undefined
  const a = o.address ?? {}
  let paymentUrl = o.payment_link_status === 'created' ? o.payment_link_url ?? '' : ''
  if (opts.usesPaymentLink && opts.createPaymentLink) {
    const { createOrderPaymentLink } = await import('@/lib/payments/payment-link')
    paymentUrl = (await createOrderPaymentLink(orderId, 48, false)).paymentLinkUrl ?? ''
  } else if (opts.usesPaymentLink && !paymentUrl) paymentUrl = '(a payment link is created when you send)'
  const vars = await resolveTemplateVariables({
    recipient: { email: r.email, first_name: r.first, last_name: r.last },
    extra: {
      order_number: o.order_number ?? '',
      order_date: day(o.created_at),
      total: inr(o.total_amount),
      order_url: await orderUrl(o.id, o.user_id),
      tracking_url: o.tracking_url ?? '',
      courier: o.delhivery_shipment_id || o.awb_number ? 'Delhivery' : '',
      awb: o.awb_number || o.tracking_number || '',
      expected_delivery: day(o.edd),
      refund_amount: inr(o.refund ?? o.total_amount),
      payment_url: paymentUrl,
      item_name: item ? itemName(item) : '',
      delivery_address: [a.full_name, a.address_line1, a.address_line2, a.landmark, [a.city, a.state].filter(Boolean).join(', '), a.postal_code]
        .filter(Boolean)
        .join(', '),
    },
  })
  return { vars, recipient: r, orderNumber: o.order_number }
}

/** Tokens in the texts that would be sent empty or as raw braces. */
export function unfilledTokens(texts: string[], vars: Record<string, string>): string[] {
  const has = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]))
  return [...new Set(texts.flatMap(findTokenKeys))].filter(k => !has.get(k)?.trim())
}
