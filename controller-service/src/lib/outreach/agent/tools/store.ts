import { createHash } from 'node:crypto'
import { z } from 'zod'
import { sendQuota } from '../guards'
import type { ToolContext, ToolDef, ToolResult } from '../types'
import { ALL, refusal, s, str } from './common'
import { sendSms } from './messaging'

// Flagship-store tools (docs/plans/OUTREACH_AGENTS.md §4). Each wraps agent/store/* inside the flagship context and
// touches only the job's own entities: its order, checkout and product references (re-read live and re-checked against
// the contact's phone) or the contact's own orders. Sends go through the gates in store/messaging.ts and are recorded in
// outreach_messages. Nothing here cancels an order or moves money. The store layer is imported on use: it pulls in
// store-core (auth, payments, shipping) that the Showcase tools never need.

const store = () => import('../store')
type Store = Awaited<ReturnType<typeof store>>

async function inStore<T>(fn: (m: Store) => Promise<T>): Promise<T> {
  const m = await store()
  return m.withFlagshipStore(() => fn(m))
}

/** The job's order, read live and checked against the contact's phone. */
async function jobOrder(ctx: ToolContext, m: Store) {
  const n = ctx.job?.refs.order?.number
  return n ? m.loadOrder(n, ctx.contact.phone) : null
}

async function jobCheckout(ctx: ToolContext, m: Store) {
  const k = ctx.job?.refs.checkout?.key
  return k ? m.loadCheckout(k, ctx.contact.phone) : null
}

/** The account to hang tasks and tickets on: the job's customer, its order's account, else the account for the phone. */
async function customerId(ctx: ToolContext, m: Store): Promise<string | null> {
  return ctx.job?.refs.customer?.userId ?? (await jobOrder(ctx, m))?.order.user_id ?? (await m.shopperConsent(ctx.contact.phone)).userId
}

const ok = (data: Record<string, unknown>, detail?: Record<string, unknown>): ToolResult => ({ ok: true, data, ...(detail ? { detail } : {}) })
const noJob = (ctx: ToolContext) => refusal('no_job', ctx)

const sendResult = (ctx: ToolContext, r: { ok: true; mode: string; messageId: string } | { ok: false; reason: string; error?: string }, data: Record<string, unknown>): ToolResult =>
  r.ok ? { ok: true, data: { sent: true, mode: r.mode, ...data }, detail: { messageId: r.messageId } } : { ...refusal(r.reason, ctx), detail: { send: r.reason, error: r.error ?? null } }

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const PRIORITY_SCHEMA = { type: 'string', enum: [...PRIORITIES], description: 'how soon the team should act, default medium' }
const NONE = { type: 'object', properties: {} }

// ── orders ──────────────────────────────────────────────────────────────────────────────

const noArgs = z.object({})

const getOrder: ToolDef<typeof noArgs> = {
  name: 'getOrder',
  description: "Read this job's order: status, payment, total, items, placed and delivered dates and the expected delivery. No address, email or phone.",
  channels: ALL,
  effect: 'read',
  group: 'orders',
  args: noArgs,
  inputSchema: NONE,
  async run(ctx) {
    if (!ctx.job) return noJob(ctx)
    return inStore(async m => {
      const o = await jobOrder(ctx, m)
      if (!o) return refusal('no_order', ctx)
      const { ref, order, items } = o
      return ok({
        number: ref.number, status: ref.status, paymentStatus: ref.paymentStatus, paymentMethod: ref.paymentMethod, total: ref.total,
        placedAt: ref.placedAt, deliveredAt: ref.deliveredAt, expectedDelivery: order.courier_edd ?? order.estimated_delivery_date, shipped: ref.hasTracking,
        items: m.itemLines(items),
      })
    })
  },
}

const findOrdersArgs = z.object({ limit: z.number().int().min(1).max(10).optional() })
const findOrders: ToolDef<typeof findOrdersArgs> = {
  name: 'findOrders',
  description: "List this customer's most recent orders (number, status, payment, total, dates), newest first. Only orders that belong to the number you are talking to.",
  channels: ALL,
  effect: 'read',
  group: 'orders',
  args: findOrdersArgs,
  inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10, description: 'how many orders, default 5' } } },
  async run(ctx, a) {
    return inStore(async m => ok({ orders: await m.recentOrders(ctx.contact.phone, a.limit ?? 5) }))
  },
}

const trackArgs = z.object({ order_number: s(40).optional() })
const trackShipment: ToolDef<typeof trackArgs> = {
  name: 'trackShipment',
  description: "Live courier status and expected delivery date for this job's order (or another order of the same customer, by number).",
  channels: ALL,
  effect: 'read',
  group: 'orders',
  args: trackArgs,
  inputSchema: { type: 'object', properties: { order_number: str("another of the customer's orders; default is this job's order", 40) } },
  async run(ctx, a) {
    return inStore(async m => {
      const o = a.order_number ? await m.loadOrder(a.order_number, ctx.contact.phone) : await jobOrder(ctx, m)
      if (!o) return refusal(a.order_number || ctx.job ? 'no_order' : 'no_job', ctx)
      const t = await m.trackShipment(o.order)
      if ('error' in t) return refusal(t.error, ctx)
      return ok({ order: o.ref.number, ...t })
    })
  },
}

const codArgs = z.object({ confirmed: z.boolean(), note: s(300).optional() })
const confirmCodOrder: ToolDef<typeof codArgs> = {
  name: 'confirmCodOrder',
  description:
    "Record that the customer confirmed (confirmed: true) or does not want (false) this cash-on-delivery order. It only writes the answer on the order for the team; it never cancels, ships or changes anything. A refusal also creates a staff task.",
  channels: ALL,
  effect: 'write',
  group: 'orders',
  args: codArgs,
  inputSchema: {
    type: 'object',
    properties: { confirmed: { type: 'boolean', description: 'true if they confirm the order, false if they refuse it' }, note: str("a short reason in the customer's words", 300) },
    required: ['confirmed'],
  },
  async run(ctx, a) {
    const job = ctx.job
    if (!job) return noJob(ctx)
    return inStore(async m => {
      const o = await jobOrder(ctx, m)
      if (!o) return refusal('no_order', ctx)
      const r = await m.recordCodConfirmation(o.order, { confirmed: a.confirmed, note: a.note, jobId: job.id, userId: await customerId(ctx, m) })
      if (!r.ok) return refusal(r.error, ctx)
      return ok({ recorded: true, confirmed: a.confirmed, alreadyRecorded: r.alreadyRecorded, order: o.ref.number }, { orderId: o.order.id })
    })
  },
}

// ── reviews ─────────────────────────────────────────────────────────────────────────────

const reviewLinkArgs = z.object({ product_id: s(60).optional() })
const sendReviewLink: ToolDef<typeof reviewLinkArgs> = {
  name: 'sendReviewLink',
  description:
    "Send the customer a WhatsApp message with a personal link to review a product from this delivered order (no login needed, valid 48 hours). The link is added by the system; you never see it. Picks the first product they have not reviewed. Needs their WhatsApp consent.",
  channels: ALL,
  effect: 'send',
  group: 'reviews',
  args: reviewLinkArgs,
  inputSchema: { type: 'object', properties: { product_id: str('a product of the order from getReviewStatus; default the first unreviewed one', 60) } },
  async run(ctx, a) {
    const { contact, job, limits, now, actor, call } = ctx
    if (!job) return noJob(ctx)
    return inStore(async m => {
      const o = await jobOrder(ctx, m)
      if (!o) return refusal('no_order', ctx)
      if (!m.isFulfilled(o.order)) return refusal('not_delivered', ctx)
      const q = await sendQuota(contact.id, 'template', limits, now)
      if (q) return refusal(q, ctx)
      const gate = await m.sendGate(contact, job, 'whatsapp')
      if (gate) return refusal(gate, ctx)
      const products = await m.reviewStatus(o.order, o.items)
      const open = products.filter(p => !p.reviewed)
      if (!open.length) return refusal('already_reviewed', ctx)
      const pick = a.product_id ? open.find(p => p.productId === a.product_id) : open[0]
      if (!pick) return refusal('unknown_product', ctx)
      const url = await m.reviewUrl(o.order, pick.productId)
      if (!url) return refusal('no_account', ctx)
      const sent = await m.sendStoreTemplate(contact, { slug: 'feedback/request', variables: { '1': o.ref.number, '2': url }, secretUrl: { url, label: '[review link]' } }, { actor, callId: call?.id ?? null })
      return sendResult(ctx, sent, { product: pick.name, moreToReview: open.length - 1 })
    })
  },
}

const ratingArgs = z.object({ rating: z.number().int().min(1).max(5), comment: s(600).optional() })
const recordRating: ToolDef<typeof ratingArgs> = {
  name: 'recordRating',
  description:
    "Record the rating (1 to 5) the customer gave for this order, with their comment in their own words. The team sees it on the customer; 3 or below also creates a task for the team to follow up.",
  channels: ALL,
  effect: 'write',
  group: 'reviews',
  args: ratingArgs,
  inputSchema: {
    type: 'object',
    properties: { rating: { type: 'integer', minimum: 1, maximum: 5, description: 'stars out of 5' }, comment: str('what they said, short', 600) },
    required: ['rating'],
  },
  async run(ctx, a) {
    const job = ctx.job
    if (!job) return noJob(ctx)
    return inStore(async m => {
      const o = await jobOrder(ctx, m)
      if (!o) return refusal('no_order', ctx)
      const r = await m.recordRating(o.order, { rating: a.rating, comment: a.comment, jobId: job.id, contactId: ctx.contact.id, actor: ctx.actor })
      // Promise a follow-up only when the staff task exists; otherwise the agent should hand the customer to a person.
      const followUp = r.lowRating && (r.taskCreated || r.alreadyRecorded)
      return ok({ recorded: true, rating: a.rating, lowRating: r.lowRating, teamWillFollowUp: followUp, ...(r.lowRating && !followUp ? { note: 'No staff task could be created: use createSupportTicket or handOff so a person follows up.' } : {}), alreadyRecorded: r.alreadyRecorded })
    })
  },
}

const getReviewStatus: ToolDef<typeof noArgs> = {
  name: 'getReviewStatus',
  description: "Which products of this job's order the customer has already reviewed, and whether the order has been delivered.",
  channels: ALL,
  effect: 'read',
  group: 'reviews',
  args: noArgs,
  inputSchema: NONE,
  async run(ctx) {
    if (!ctx.job) return noJob(ctx)
    return inStore(async m => {
      const o = await jobOrder(ctx, m)
      if (!o) return refusal('no_order', ctx)
      const products = await m.reviewStatus(o.order, o.items)
      return ok({ order: o.ref.number, delivered: m.isFulfilled(o.order), products: products.map(p => ({ id: p.productId, name: p.name, reviewed: p.reviewed })), allReviewed: products.length > 0 && products.every(p => p.reviewed) })
    })
  },
}

// ── checkout ────────────────────────────────────────────────────────────────────────────

const getAbandonedCheckout: ToolDef<typeof noArgs> = {
  name: 'getAbandonedCheckout',
  description: "Read this job's abandoned cart or failed checkout: the items, total, when it happened and whether the customer has ordered since.",
  channels: ALL,
  effect: 'read',
  group: 'checkout',
  args: noArgs,
  inputSchema: NONE,
  async run(ctx) {
    if (!ctx.job) return noJob(ctx)
    return inStore(async m => {
      const c = await jobCheckout(ctx, m)
      if (!c) return refusal('no_checkout', ctx)
      return ok({ kind: c.ref.kind, total: c.ref.total, itemCount: c.ref.itemCount, at: c.ref.at, orderedSince: c.orderedSince, items: m.checkoutLines(c.items) })
    })
  },
}

const checkoutLinkArgs = z.object({ channel: z.enum(['whatsapp', 'sms']).optional() })
const sendCheckoutLink: ToolDef<typeof checkoutLinkArgs> = {
  name: 'sendCheckoutLink',
  description:
    "Send the customer a message with a link back to their cart or checkout (WhatsApp by default, or SMS). The link is added by the system. WhatsApp needs their consent; a promotional agent also needs them not to have opted out of marketing.",
  channels: ALL,
  effect: 'send',
  group: 'checkout',
  args: checkoutLinkArgs,
  inputSchema: { type: 'object', properties: { channel: { type: 'string', enum: ['whatsapp', 'sms'], description: 'default whatsapp' } } },
  async run(ctx, a) {
    if (!ctx.job) return noJob(ctx)
    const { sendShopperSms, sendShopperTemplate } = await import('../store/templates')
    return a.channel === 'sms' ? sendShopperSms(ctx, 'cart/abandoned') : sendShopperTemplate(ctx, 'cart/abandoned')
  },
}

const sendPaymentLink: ToolDef<typeof noArgs> = {
  name: 'sendPaymentLink',
  description:
    "Text the customer a secure payment link for this job's own unpaid order. Refused for a paid, cancelled or cash-on-delivery order. The link is added by the system; you never see it.",
  channels: ALL,
  effect: 'send',
  group: 'checkout',
  args: noArgs,
  inputSchema: NONE,
  async run(ctx) {
    const { contact, job, limits, now, actor, call } = ctx
    if (!job) return noJob(ctx)
    return inStore(async m => {
      const o = await jobOrder(ctx, m)
      if (!o) return refusal('no_order', ctx)
      const q = await sendQuota(contact.id, 'template', limits, now)
      if (q) return refusal(q, ctx)
      const gate = await m.sendGate(contact, job, 'sms')
      if (gate) return refusal(gate, ctx)
      const meta = { actor, callId: call?.id ?? null }
      const { captureMode } = await import('../../whatsapp')
      try {
        if (captureMode()) {
          m.assertPayable(o.order)
          await m.recordPaymentLinkSent(contact, { orderNumber: o.ref.number, mode: 'captured' }, meta)
          return ok({ sent: true, mode: 'captured', order: o.ref.number })
        }
        const link = await m.paymentLinkFor(o.order)
        const store_name = await m.storeName()
        const sent = await m.sendStoreSms(contact, { slug: 'order/payment-failed', variables: { store_name, order_number: o.ref.number, short_url: link.paymentLinkUrl } }, meta)
        return sendResult(ctx, sent, { order: o.ref.number, channel: 'sms', total: o.ref.total })
      } catch (e) {
        if (e instanceof m.PaymentLinkRefusal) return refusal(e.code, ctx)
        const status = (e as { status?: number })?.status
        return { ...refusal(status === 409 ? 'not_unpaid' : 'failed', ctx), detail: { error: (e as Error)?.message ?? 'error' } }
      }
    })
  },
}

const deliveryArgs = z.object({ pincode: z.string().trim().regex(/^\d{6}$/, 'a 6-digit pincode') })
const checkDelivery: ToolDef<typeof deliveryArgs> = {
  name: 'checkDelivery',
  description: 'Check whether we deliver to a pincode (and whether cash on delivery works there) and the estimated delivery date.',
  channels: ALL,
  effect: 'read',
  group: 'checkout',
  args: deliveryArgs,
  inputSchema: { type: 'object', properties: { pincode: { type: 'string', pattern: '^\\d{6}$', description: 'six-digit pincode' } }, required: ['pincode'] },
  async run(ctx, a) {
    return inStore(async m => ok(await m.checkDelivery(a.pincode)))
  },
}

// ── catalog ─────────────────────────────────────────────────────────────────────────────

const searchArgs = z.object({ query: s(200), limit: z.number().int().min(1).max(8).optional() })
const searchProducts: ToolDef<typeof searchArgs> = {
  name: 'searchProducts',
  description: 'Search the store catalog for what the customer describes. Returns up to a few matching products with price and stock.',
  channels: ALL,
  effect: 'read',
  group: 'catalog',
  args: searchArgs,
  inputSchema: { type: 'object', properties: { query: str('what they are looking for', 200), limit: { type: 'integer', minimum: 1, maximum: 8, description: 'default 5' } }, required: ['query'] },
  async run(ctx, a) {
    return inStore(async m => ok({ products: await m.searchProducts(a.query, a.limit ?? 5) }))
  },
}

const productArgs = z.object({ product_id: s(120) })
const getProduct: ToolDef<typeof productArgs> = {
  name: 'getProduct',
  description: "A product's details: description, price, stock, warranty, return window and specifications. Answer only from these.",
  channels: ALL,
  effect: 'read',
  group: 'catalog',
  args: productArgs,
  inputSchema: { type: 'object', properties: { product_id: str('the product id from searchProducts, or its slug', 120) }, required: ['product_id'] },
  async run(ctx, a) {
    return inStore(async m => {
      const p = await m.getProduct(a.product_id)
      return p ? ok(p) : refusal('no_product', ctx)
    })
  },
}

const productLinkArgs = z.object({ product_id: s(120) })
const sendProductLink: ToolDef<typeof productLinkArgs> = {
  name: 'sendProductLink',
  description:
    "Send the customer a WhatsApp message with the link to a product page. Works only while their 24 hour chat window is open (they messaged us recently) and with their consent. The link is added by the system.",
  channels: ALL,
  effect: 'send',
  group: 'catalog',
  args: productLinkArgs,
  inputSchema: { type: 'object', properties: { product_id: str('the product id from searchProducts, or its slug', 120) }, required: ['product_id'] },
  async run(ctx, a) {
    const { contact, job, limits, now, actor, call } = ctx
    return inStore(async m => {
      const q = await sendQuota(contact.id, 'text', limits, now)
      if (q) return refusal(q, ctx)
      const gate = await m.sendGate(contact, job, 'whatsapp', { text: true, now })
      if (gate) return refusal(gate, ctx)
      const p = await m.productCard(a.product_id)
      if (!p?.url) return refusal('no_product', ctx)
      const sent = await m.sendStoreText(contact, `${p.name}: ${p.url}`, { actor, callId: call?.id ?? null })
      return sendResult(ctx, sent, { product: p.name })
    })
  },
}

const getStoreInfo: ToolDef<typeof noArgs> = {
  name: 'getStoreInfo',
  description: "The store's name, contact email and phone, website and opening hours.",
  channels: ALL,
  effect: 'read',
  group: 'catalog',
  args: noArgs,
  inputSchema: NONE,
  async run() {
    return inStore(async m => ok({ ...(await m.storeInfo()) }))
  },
}

// ── support ─────────────────────────────────────────────────────────────────────────────

const ticketArgs = z.object({ summary: s(1500), priority: z.enum(PRIORITIES).optional() })
const createSupportTicket: ToolDef<typeof ticketArgs> = {
  name: 'createSupportTicket',
  description:
    "Open a support ticket for the team with a summary of the conversation, so a person follows up. Tell the customer the team will be in touch; do not promise a time or an outcome.",
  channels: ALL,
  effect: 'write',
  group: 'support',
  args: ticketArgs,
  inputSchema: { type: 'object', properties: { summary: str('what the customer said and what they need, in a few sentences', 1500), priority: PRIORITY_SCHEMA }, required: ['summary'] },
  async run(ctx, a) {
    return inStore(async m => {
      const t = await m.openSupportTicket({
        userId: await customerId(ctx, m),
        phone: ctx.contact.phone,
        name: ctx.contact.owner_name,
        summary: a.summary,
        reason: `Outreach agent${ctx.job?.refs.order ? ` (order #${ctx.job.refs.order.number})` : ''}${a.priority && a.priority !== 'medium' ? ` [${a.priority}]` : ''}`,
      })
      return ok({ ticket: t.ticket, alreadyOpen: t.alreadyOpen }, { sessionId: t.sessionId })
    })
  },
}

const taskArgs = z.object({ title: s(200), details: s(1000).optional(), priority: z.enum(PRIORITIES).optional() })
const createStaffTask: ToolDef<typeof taskArgs> = {
  name: 'createStaffTask',
  description: "Add a task for the team on this customer (for example to call them back or check something). The same task is not created twice while it is open.",
  channels: ALL,
  effect: 'write',
  group: 'support',
  args: taskArgs,
  inputSchema: { type: 'object', properties: { title: str('what the team should do', 200), details: str('context the team needs', 1000), priority: PRIORITY_SCHEMA }, required: ['title'] },
  async run(ctx, a) {
    return inStore(async m => {
      const userId = await customerId(ctx, m)
      if (!userId) return refusal('no_customer_account', ctx)
      const key = `agent:${ctx.job?.id ?? ctx.contact.id}:${createHash('sha1').update(a.title.toLowerCase()).digest('hex').slice(0, 12)}`
      const id = await m.createStaffTask({ userId, key, title: a.title, description: a.details, priority: a.priority })
      return ok({ created: !!id, alreadyOpen: !id })
    })
  },
}

export const STORE_TOOLS: ToolDef<any>[] = [
  getOrder, findOrders, trackShipment, confirmCodOrder,
  sendReviewLink, recordRating, getReviewStatus,
  getAbandonedCheckout, sendCheckoutLink, sendPaymentLink, checkDelivery,
  searchProducts, getProduct, sendProductLink, getStoreInfo,
  createSupportTicket, createStaffTask,
  sendSms,
]
