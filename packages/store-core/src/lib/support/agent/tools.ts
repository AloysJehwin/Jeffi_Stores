import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { getCustomerTool } from '@/lib/customer-agent/tools'
import { trackOrder } from '@/lib/shipping/track'
import { checkPincodeServiceability } from '@/lib/shipping/delhivery'
import { getOrderItemsPolicy } from '@/lib/catalog/return-policy'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { getPolicyBySlug } from '@/lib/legals/policies'
import { platformBrandName } from '@/lib/catalog/brand'
import { addressChangeBlockReason, ADDRESS_SNAPSHOT_COLUMNS } from '@/lib/orders/address-change'
import { ORDER_ADDRESS_SELECT } from '@/lib/orders/address-change-request'
import { CANCELLABLE_STATUSES } from '@/lib/orders/orders'
import { RETURN_REASONS } from '@/lib/orders/returns'
import type { SessionRow } from '../sessions'
import type { OrderCardPayload, SupportPayload } from '../types'

// The policy texts name the platform (as "<brand> Stores" or "<brand> Commerce"); the store's own name replaces it.
const PLATFORM_NAME_RE = () => new RegExp(`${platformBrandName().split(' ')[0]} (Stores|Commerce)`, 'g')

// The support assistant's tools. Everything is scoped to the chat's customer; tools that change
// something only propose it (the customer confirms in the chat, see actions.ts).

export interface SupportToolCtx {
  session: SessionRow
  userId: string | null
  brand: string
}

export interface Proposal {
  kind: 'cancel_order' | 'return_request' | 'address_change'
  args: Record<string, unknown>
  title: string
  detail: string
  confirmLabel: string
}

export interface SupportToolResult {
  data: unknown
  payloads?: SupportPayload[]
  proposal?: Proposal
  handoff?: { reason: string; summary: string }
}

export interface ToolSchema {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required?: string[]
}

export interface SupportTool {
  name: string
  description: string
  inputSchema: ToolSchema
  /** Needs a linked customer account (WhatsApp numbers we can't match get product help only). */
  account?: boolean
  run: (input: Record<string, any>, ctx: SupportToolCtx) => Promise<SupportToolResult>
}

const NO_ACCOUNT = {
  data: {
    error:
      "This chat isn't linked to a customer account, so you can't see orders. Ask for the order number and the phone or email used to place it, then hand off to a person.",
  },
}

const inr = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
const day = (v: unknown) => (v ? new Date(v as string).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null)

async function findOrder(userId: string, orderNumber: unknown): Promise<any | null> {
  const n = String(orderNumber ?? '').trim().replace(/^#/, '')
  if (!n) return null
  return queryOne(
    `SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_mode, o.total_amount, o.awb_number,
            o.shipment_status, o.courier_edd, o.created_at, o.delivered_at, o.shipped_at, o.cancelled_at, o.updated_at
       FROM orders o
      WHERE o.user_id = $1 AND o.status <> 'draft' AND upper(o.order_number) = upper($2)
      LIMIT 1`,
    [userId, n]
  )
}

const notFound = (orderNumber: unknown) => ({ data: { error: `No order ${orderNumber} in this customer's account. Ask them to check the number, or list their orders.` } })

async function orderCards(userId: string, ids: string[]): Promise<OrderCardPayload> {
  const rows = await queryMany<any>(
    `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_amount, o.created_at, o.awb_number,
            (SELECT string_agg(oi.product_name, ', ' ORDER BY oi.id) FROM (SELECT product_name, id FROM order_items WHERE order_id = o.id LIMIT 3) oi) AS items
       FROM orders o WHERE o.user_id = $1 AND o.id = ANY($2::uuid[]) ORDER BY o.created_at DESC`,
    [userId, ids]
  )
  return {
    type: 'orders',
    orders: rows.map(r => ({
      id: r.id,
      number: r.order_number,
      status: r.status,
      paymentStatus: r.payment_status,
      total: Number(r.total_amount),
      placedAt: new Date(r.created_at).toISOString(),
      items: r.items,
      tracking: r.awb_number,
    })),
  }
}

function fromCustomerTool(name: string, description?: string): SupportTool {
  const t = getCustomerTool(name)!
  return {
    name,
    description: description ?? t.description,
    inputSchema: t.inputSchema,
    run: async (input, ctx) => ({ data: await t.handler(input, { authenticatedUserId: ctx.userId ?? '00000000-0000-0000-0000-000000000000' }) }),
  }
}

export const SUPPORT_TOOLS: SupportTool[] = [
  {
    name: 'get_my_orders',
    description:
      "The customer's recent orders (newest first) with status, payment status, total and AWB. The chat shows them as order cards, so don't repeat every field in your reply.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 10 },
        status: { type: 'string', description: 'pending|confirmed|processing|shipped|delivered|cancelled' },
      },
    },
    account: true,
    run: async ({ limit, status }, ctx) => {
      const lim = Math.min(10, Math.max(1, Number(limit) || 5))
      const rows = await queryMany<any>(
        `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_amount, o.created_at, o.delivered_at, o.awb_number, o.shipment_status
           FROM orders o WHERE o.user_id = $1 AND o.status <> 'draft' ${status ? 'AND o.status = $3' : ''}
          ORDER BY o.created_at DESC LIMIT $2`,
        status ? [ctx.userId, lim, String(status)] : [ctx.userId, lim]
      )
      if (!rows.length) return { data: { orders: [], note: status ? `No ${status} orders.` : 'This customer has no orders yet.' } }
      return {
        data: { orders: rows.map(r => ({ number: r.order_number, status: r.status, payment: r.payment_status, total: inr(r.total_amount), placed: day(r.created_at), delivered: day(r.delivered_at), shipment: r.shipment_status, awb: r.awb_number })) },
        payloads: [await orderCards(ctx.userId!, rows.map(r => r.id))],
      }
    },
  },
  {
    name: 'get_order_details',
    description: 'One order by its number: items (with order_item_id), amounts, payment, shipment status, expected delivery.',
    inputSchema: { type: 'object', properties: { orderNumber: { type: 'string' } }, required: ['orderNumber'] },
    account: true,
    run: async ({ orderNumber }, ctx) => {
      const o = await findOrder(ctx.userId!, orderNumber)
      if (!o) return notFound(orderNumber)
      const items = await queryMany<any>(
        `SELECT id AS order_item_id, product_name, variant_name, quantity::int, total_price, is_digital FROM order_items WHERE order_id = $1 ORDER BY id`,
        [o.id]
      )
      return {
        data: {
          number: o.order_number,
          status: o.status,
          payment: { status: o.payment_status, mode: o.payment_mode },
          total: inr(o.total_amount),
          placed: day(o.created_at),
          shipped: day(o.shipped_at),
          delivered: day(o.delivered_at),
          cancelled: day(o.cancelled_at),
          shipment: o.shipment_status,
          expectedDelivery: day(o.courier_edd),
          awb: o.awb_number,
          items: items.map(i => ({ ...i, total_price: inr(i.total_price) })),
        },
        payloads: [await orderCards(ctx.userId!, [o.id])],
      }
    },
  },
  {
    name: 'track_order',
    description: "Live courier tracking for one of the customer's orders: current status, expected delivery and the latest scans.",
    inputSchema: { type: 'object', properties: { orderNumber: { type: 'string' } }, required: ['orderNumber'] },
    account: true,
    run: async ({ orderNumber }, ctx) => {
      const o = await findOrder(ctx.userId!, orderNumber)
      if (!o) return notFound(orderNumber)
      if (!o.awb_number) {
        return { data: { number: o.order_number, status: o.status, note: 'Not shipped yet; no courier tracking. Orders ship after they are packed.' } }
      }
      try {
        const t = await trackOrder(o)
        if (!t) return { data: { number: o.order_number, status: o.status, awb: o.awb_number, note: 'The courier has no scans yet.' } }
        return {
          data: {
            number: o.order_number,
            awb: t.awb,
            courierStatus: t.status,
            shipmentStatus: t.shipmentStatus,
            updatedAt: t.statusDateTime,
            expectedDelivery: day(t.expectedDelivery ?? o.courier_edd),
            instructions: t.instructions,
            latestScans: t.scans.slice(-5).reverse(),
          },
          payloads: [{ type: 'links', links: [{ label: 'Track order', href: `/orders/${o.id}` }] }],
        }
      } catch (err) {
        return { data: { number: o.order_number, status: o.status, shipment: o.shipment_status, expectedDelivery: day(o.courier_edd), error: `Live tracking unavailable: ${err instanceof Error ? err.message : err}` } }
      }
    },
  },
  {
    name: 'get_return_options',
    description:
      "Whether a delivered order can be returned for a refund or replaced, item by item (with order_item_id), the window left, an open request if any, and the monthly limit. Check this before propose_return.",
    inputSchema: { type: 'object', properties: { orderNumber: { type: 'string' } }, required: ['orderNumber'] },
    account: true,
    run: async ({ orderNumber }, ctx) => {
      const o = await findOrder(ctx.userId!, orderNumber)
      if (!o) return notFound(orderNumber)
      if (o.status !== 'delivered') return { data: { number: o.order_number, status: o.status, eligible: false, why: 'Only delivered orders can be returned or replaced.' } }
      const delivered = new Date(o.delivered_at || o.updated_at)
      const daysSince = Math.floor((Date.now() - delivered.getTime()) / 86_400_000)
      const [policies, items, open, monthly, values] = await Promise.all([
        getOrderItemsPolicy(o.id),
        queryMany<any>(`SELECT id AS order_item_id, product_id, product_name, variant_name, quantity::int, is_digital FROM order_items WHERE order_id = $1 ORDER BY id`, [o.id]),
        queryOne<any>(`SELECT id, type, status, created_at FROM return_requests WHERE order_id = $1 AND status NOT IN ('rejected', 'completed') LIMIT 1`, [o.id]),
        queryOne<{ n: string }>(
          `SELECT count(*) AS n FROM return_requests rr JOIN orders o ON o.id = rr.order_id
            WHERE o.user_id = $1 AND rr.status <> 'rejected' AND date_trunc('month', rr.created_at) = date_trunc('month', now())`,
          [ctx.userId]
        ),
        getBusinessValues().catch(() => null),
      ])
      const byProduct = new Map(policies.map(p => [String(p.product_id), p]))
      return {
        data: {
          number: o.order_number,
          deliveredOn: day(delivered),
          daysSinceDelivery: daysSince,
          openRequest: open ? { type: open.type, status: open.status, since: day(open.created_at) } : null,
          monthlyLimitReached: Number(monthly?.n ?? 0) >= Number(process.env.MONTHLY_RETURN_LIMIT || 1),
          returnCharge: inr(values?.returnStandardCharge ?? 0),
          reasons: RETURN_REASONS,
          items: items.map(i => {
            const p = byProduct.get(String(i.product_id))
            const refundLeft = p?.return_allowed ? p.return_window_days - daysSince : null
            const replaceLeft = p?.replacement_allowed ? p.replacement_window_days - daysSince : null
            return {
              order_item_id: i.order_item_id,
              name: [i.product_name, i.variant_name].filter(Boolean).join(' — '),
              quantity: i.quantity,
              refund: i.is_digital ? 'not returnable (digital)' : refundLeft == null ? 'not allowed' : refundLeft >= 0 ? `allowed, ${refundLeft} day(s) left` : 'window closed',
              replacement: i.is_digital ? 'not allowed' : replaceLeft == null ? 'not allowed' : replaceLeft >= 0 ? `allowed, ${replaceLeft} day(s) left` : 'window closed',
            }
          }),
        },
      }
    },
  },
  {
    name: 'get_refund_status',
    description: "Refund and return status for one of the customer's orders: the latest return request, refund amounts, and the order's payment status (cancelled prepaid orders are refunded to the original method).",
    inputSchema: { type: 'object', properties: { orderNumber: { type: 'string' } }, required: ['orderNumber'] },
    account: true,
    run: async ({ orderNumber }, ctx) => {
      const o = await findOrder(ctx.userId!, orderNumber)
      if (!o) return notFound(orderNumber)
      const rr = await queryOne<any>(`SELECT id, type, status, reason, created_at, resolved_at, rvp_awb_number, admin_notes FROM return_requests WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [o.id])
      const items = rr ? await queryMany<any>(`SELECT refund_amount FROM return_request_items WHERE return_request_id = $1`, [rr.id]) : []
      const gross = items.reduce((s, i) => s + (Number(i.refund_amount) || 0), 0)
      const charge = rr?.type === 'refund' ? Math.min((await getBusinessValues().catch(() => null))?.returnStandardCharge ?? 0, gross) : 0
      return {
        data: {
          number: o.order_number,
          orderStatus: o.status,
          paymentStatus: o.payment_status,
          paymentMode: o.payment_mode,
          cancelledOn: day(o.cancelled_at),
          returnRequest: rr
            ? { type: rr.type, status: rr.status, reason: rr.reason, raised: day(rr.created_at), resolved: day(rr.resolved_at), pickupAwb: rr.rvp_awb_number, note: rr.admin_notes, refund: rr.type === 'refund' ? { gross: inr(gross), returnCharge: inr(charge), net: inr(gross - charge) } : null }
            : null,
        },
      }
    },
  },
  {
    name: 'get_store_policies',
    description: "The store's published policy on a topic. Quote it accurately; don't invent terms.",
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string', enum: ['returns', 'shipping', 'cancellation', 'warranty', 'faq', 'privacy', 'terms'] } },
      required: ['topic'],
    },
    run: async ({ topic }, ctx) => {
      const slug = ({ returns: 'return-refund-policy', shipping: 'shipping-policy', cancellation: 'cancellation-policy', warranty: 'warranty-policy', faq: 'faq', privacy: 'privacy-policy', terms: 'terms-and-conditions' } as Record<string, string>)[String(topic)]
      const p = slug ? getPolicyBySlug(slug) : null
      if (!p) return { data: { error: 'Unknown topic' } }
      const text = p.sections.map(s => `${s.heading}\n${Array.isArray(s.body) ? s.body.join('\n') : s.body}`).join('\n\n').replace(PLATFORM_NAME_RE(), ctx.brand)
      return { data: { title: p.title, text: text.slice(0, 6000), link: `/legal/${p.slug}` } }
    },
  },
  {
    name: 'check_pincode',
    description: 'Whether the store delivers to a 6-digit pincode, and whether cash on delivery is available there.',
    inputSchema: { type: 'object', properties: { pincode: { type: 'string' } }, required: ['pincode'] },
    run: async ({ pincode }) => {
      const pin = String(pincode ?? '').replace(/\D/g, '')
      if (pin.length !== 6) return { data: { error: 'A pincode has 6 digits.' } }
      const s = await checkPincodeServiceability(pin)
      return { data: { pincode: pin, delivers: s.serviceable, cod: s.cod, district: s.district ?? null, state: s.state ?? null, note: s.error ?? null } }
    },
  },
  {
    name: 'list_my_addresses',
    description: "The customer's saved addresses (id, city, pincode). Use before propose_address_change.",
    inputSchema: { type: 'object', properties: {} },
    account: true,
    run: async (_input, ctx) => {
      const rows = await queryMany<any>(`SELECT id, ${ADDRESS_SNAPSHOT_COLUMNS}, is_default FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 10`, [ctx.userId])
      return { data: { addresses: rows, note: rows.length ? null : 'No saved addresses. The customer can add one under Account → Addresses.' } }
    },
  },
  fromCustomerTool('search_products'),
  fromCustomerTool('recommend_for_project'),
  fromCustomerTool('get_product'),
  {
    name: 'propose_cancel_order',
    description:
      'Offer to cancel one of the customer\'s orders. Shows the customer a Confirm button; nothing happens until they confirm. Only pending, confirmed or processing orders can be cancelled; paid orders become a cancellation request that the store reviews and refunds.',
    inputSchema: {
      type: 'object',
      properties: { orderNumber: { type: 'string' }, reason: { type: 'string', description: "The customer's reason, in a few words" } },
      required: ['orderNumber'],
    },
    account: true,
    run: async ({ orderNumber, reason }, ctx) => {
      const o = await findOrder(ctx.userId!, orderNumber)
      if (!o) return notFound(orderNumber)
      if (!CANCELLABLE_STATUSES.includes(o.status)) return { data: { error: `Order ${o.order_number} is ${o.status}; it can't be cancelled now.` } }
      const paid = !['unpaid', 'failed', 'pending'].includes(String(o.payment_status)) && o.payment_mode !== 'cod'
      return {
        data: { proposed: true, number: o.order_number, paid },
        proposal: {
          kind: 'cancel_order',
          args: { orderId: o.id, orderNumber: o.order_number, reason: reason ? String(reason).slice(0, 300) : null },
          title: `Cancel order #${o.order_number}?`,
          detail: `${inr(o.total_amount)} · ${o.status}${paid ? ' · paid orders are refunded to the original payment method after the store approves' : ''}`,
          confirmLabel: 'Cancel order',
        },
      }
    },
  },
  {
    name: 'propose_return',
    description:
      'Offer to raise a return (refund) or replacement for items of a delivered order. Call get_return_options first and use its order_item_ids. Shows a Confirm button; nothing happens until the customer confirms.',
    inputSchema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'string' },
        type: { type: 'string', enum: ['refund', 'replacement'] },
        reason: { type: 'string', enum: RETURN_REASONS },
        description: { type: 'string', description: 'What is wrong, in the customer\'s words (English)' },
        itemIds: { type: 'array', items: { type: 'string' }, description: 'order_item_id values from get_return_options' },
      },
      required: ['orderNumber', 'type', 'reason', 'itemIds'],
    },
    account: true,
    run: async ({ orderNumber, type, reason, description, itemIds }, ctx) => {
      const o = await findOrder(ctx.userId!, orderNumber)
      if (!o) return notFound(orderNumber)
      if (o.status !== 'delivered') return { data: { error: 'Only delivered orders can be returned.' } }
      const ids = (Array.isArray(itemIds) ? itemIds : []).map(String)
      const items = await queryMany<any>(`SELECT id, product_name, quantity::int FROM order_items WHERE order_id = $1 AND id = ANY($2::uuid[])`, [o.id, ids]).catch(() => [])
      if (!items.length || items.length !== ids.length) return { data: { error: 'Those items are not on this order. Use the order_item_ids from get_return_options.' } }
      if (!['refund', 'replacement'].includes(type) || !RETURN_REASONS.includes(reason)) return { data: { error: 'Invalid type or reason.' } }
      return {
        data: { proposed: true, number: o.order_number },
        proposal: {
          kind: 'return_request',
          args: { orderId: o.id, orderNumber: o.order_number, type, reason, description: description ? String(description).slice(0, 1000) : null, items: items.map(i => ({ order_item_id: i.id, quantity: i.quantity })) },
          title: `${type === 'refund' ? 'Return for a refund' : 'Replace'}: order #${o.order_number}`,
          detail: `${items.map(i => `${i.product_name} × ${i.quantity}`).join(', ')} · ${String(reason).replace(/_/g, ' ')}`,
          confirmLabel: type === 'refund' ? 'Request return' : 'Request replacement',
        },
      }
    },
  },
  {
    name: 'propose_address_change',
    description:
      'Offer to deliver a confirmed (not yet shipped) order to another of the customer\'s saved addresses. Use list_my_addresses for the id. Shows a Confirm button; the store reviews the request.',
    inputSchema: { type: 'object', properties: { orderNumber: { type: 'string' }, addressId: { type: 'string' } }, required: ['orderNumber', 'addressId'] },
    account: true,
    run: async ({ orderNumber, addressId }, ctx) => {
      const o = await findOrder(ctx.userId!, orderNumber)
      if (!o) return notFound(orderNumber)
      const full = await queryOne<any>(`${ORDER_ADDRESS_SELECT} WHERE o.id = $1`, [o.id])
      const blocked = full ? addressChangeBlockReason(full) : 'Order not found'
      if (blocked) return { data: { error: blocked } }
      const a = await queryOne<any>(`SELECT id, ${ADDRESS_SNAPSHOT_COLUMNS} FROM addresses WHERE id = $1 AND user_id = $2`, [String(addressId), ctx.userId]).catch(() => null)
      if (!a) return { data: { error: 'Not one of the customer\'s saved addresses. Use list_my_addresses.' } }
      return {
        data: { proposed: true, number: o.order_number },
        proposal: {
          kind: 'address_change',
          args: { orderId: o.id, orderNumber: o.order_number, addressId: a.id },
          title: `Deliver order #${o.order_number} to a new address?`,
          detail: [a.full_name, a.address_line1, a.city, `${a.state} ${a.postal_code}`].filter(Boolean).join(', '),
          confirmLabel: 'Request change',
        },
      }
    },
  },
  {
    name: 'handoff_to_human',
    description:
      'Bring in a person from the store. Use only when you cannot resolve it yourself: a refund or payment dispute, damaged or wrong goods that need judgement, a policy exception, anything legal or safety related, or the customer asks for a person again after you tried. Tell the customer a specialist will join.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'One line: why a person is needed' },
        summary: { type: 'string', description: 'For the agent: the issue, order numbers, what you checked and what the customer wants (English, under 80 words)' },
      },
      required: ['reason', 'summary'],
    },
    run: async ({ reason, summary }) => ({
      data: { ok: true },
      handoff: { reason: String(reason ?? '').slice(0, 300), summary: String(summary ?? '').slice(0, 1500) },
    }),
  },
]

export function getSupportTool(name: string): SupportTool | null {
  return SUPPORT_TOOLS.find(t => t.name === name) ?? null
}

export async function runSupportTool(name: string, input: Record<string, any>, ctx: SupportToolCtx): Promise<SupportToolResult> {
  const tool = getSupportTool(name)
  if (!tool) return { data: { error: `Unknown tool ${name}` } }
  if (tool.account && !ctx.userId) return NO_ACCOUNT
  return tool.run(input ?? {}, ctx)
}
