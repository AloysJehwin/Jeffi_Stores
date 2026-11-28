import { sendQuota } from '../guards'
import { refusal } from '../tools/common'
import type { ToolContext, ToolResult } from '../types'
import * as m from './index'
import type { ShopperTemplate } from './template-slugs'

// The store templates a shopper agent may send (WhatsApp and the matching DLT SMS). Every variable is built here from the
// job's own order or checkout; the model chooses the template, never the values. cart/abandoned is marketing-category.

const MARKETING = new Set<string>(['cart/abandoned'])
const COURIER = 'Delhivery'

interface Built {
  wa: Record<string, string>
  sms: Record<string, string>
  buttonUrl?: string
}

/** The variables for a template from the job's references, or a refusal code. */
async function build(slug: ShopperTemplate, ctx: ToolContext): Promise<Built | string> {
  const job = ctx.job
  if (!job) return 'no_job'
  if (slug === 'cart/abandoned') {
    const key = job.refs.checkout?.key
    const co = key ? await m.loadCheckout(key, ctx.contact.phone) : null
    if (!co) return 'no_checkout'
    if (co.orderedSince) return 'already_ordered'
    const url = await m.checkoutUrl(co)
    return { wa: { '1': co.ref.itemsShort }, sms: { short_url: url }, buttonUrl: url }
  }
  const number = job.refs.order?.number
  const loaded = number ? await m.loadOrder(number, ctx.contact.phone) : null
  if (!loaded) return 'no_order'
  const { order, ref } = loaded
  const { orderUrlById } = await import('@/lib/shared/customer-links')
  const link = () => orderUrlById(order.id)
  const base = { order_number: ref.number }
  switch (slug) {
    case 'order/confirmed':
      return { wa: { '1': ref.number, '2': ref.total }, sms: { ...base, total: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(order.total_amount)), short_url: await link() } }
    case 'order/shipped':
      if (!order.awb_number) return 'not_shipped'
      return { wa: { '1': ref.number, '2': COURIER, '3': order.awb_number }, sms: { ...base, courier: COURIER, awb: order.awb_number, short_url: await link() } }
    case 'order/out-for-delivery':
      return { wa: { '1': ref.number }, sms: base }
    case 'order/delivered':
      if (!m.isFulfilled(order)) return 'not_delivered'
      return { wa: { '1': ref.number }, sms: { ...base, short_url: await link() } }
    default:
      if (order.payment_status === 'paid') return 'already_paid'
      return { wa: { '1': ref.number }, sms: { ...base, short_url: await link() } }
  }
}

const done = (ctx: ToolContext, r: m.StoreSendOutcome, extra: Record<string, unknown>): ToolResult =>
  r.ok ? { ok: true, data: { sent: true, mode: r.mode, ...extra }, detail: { messageId: r.messageId } } : { ...refusal(r.reason, ctx), detail: { send: r.reason, error: r.error ?? null } }

export async function sendShopperTemplate(ctx: ToolContext, slug: ShopperTemplate): Promise<ToolResult> {
  const { contact, job, limits, now, actor, call } = ctx
  return m.withFlagshipStore(async () => {
    const q = await sendQuota(contact.id, 'template', limits, now)
    if (q) return refusal(q, ctx)
    const gate = await m.sendGate(contact, job, 'whatsapp', { marketing: MARKETING.has(slug) })
    if (gate) return refusal(gate, ctx)
    const v = await build(slug, ctx)
    if (typeof v === 'string') return refusal(v, ctx)
    return done(ctx, await m.sendStoreTemplate(contact, { slug, variables: v.wa, buttonUrl: v.buttonUrl }, { actor, callId: call?.id ?? null }), { template: slug })
  })
}

export async function sendShopperSms(ctx: ToolContext, slug: ShopperTemplate): Promise<ToolResult> {
  const { contact, job, limits, now, actor, call } = ctx
  return m.withFlagshipStore(async () => {
    const q = await sendQuota(contact.id, 'template', limits, now)
    if (q) return refusal(q, ctx)
    const gate = await m.sendGate(contact, job, 'sms', { marketing: MARKETING.has(slug) })
    if (gate) return refusal(gate, ctx)
    const v = await build(slug, ctx)
    if (typeof v === 'string') return refusal(v, ctx)
    const store_name = await m.storeName()
    return done(ctx, await m.sendStoreSms(contact, { slug, variables: { store_name, ...v.sms } }, { actor, callId: call?.id ?? null }), { template: slug, channel: 'sms' })
  })
}
