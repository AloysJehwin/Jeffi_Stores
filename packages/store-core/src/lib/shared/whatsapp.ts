import { logMessage } from '@/lib/shared/message-log'
import { storeBaseUrlAsync } from '@/lib/catalog/brand'
import { orderUrlByNumber } from '@/lib/shared/customer-links'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { getWhatsAppProvider } from '@/lib/shared/messaging'
import { messagingGateAllows, debitMessageEstimate } from '@/lib/shared/messaging/billing'
import { estimateFor } from '@/lib/shared/messaging/pricing'
import { sendByTemplate } from '@/lib/shared/send-by-template'
import type { OutboundMedia } from '@/lib/shared/messaging/types'
import { currentReplyScope } from '@/lib/replies/scope'

// WhatsApp wrappers now dispatch via sendByTemplate (slug → messaging-service).
// Variable numbering must match the Meta-approved Twilio Content templates (see seed/catalog.ts).
// Infra kept here: channel gate, phone normalize, free-text (24h window), campaign-SID path, registry.

async function whatsappChannelEnabled(): Promise<boolean> {
  try { return (await getFeatureFlags()).whatsappEnabled }
  catch { return process.env.WHATSAPP_DISABLED !== 'true' }
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 13 && digits.startsWith('091')) return `+91${digits.slice(3)}`
  if (phone.trim().startsWith('+')) return phone.trim()
  return null
}

async function sendBySlug(
  phone: string | null | undefined,
  slug: string,
  variables: Record<string, string | number>,
  reference?: string
): Promise<boolean> {
  const normalized = normalizePhone(phone)
  if (!normalized) return false
  if (!(await whatsappChannelEnabled())) return false
  const res = await sendByTemplate({ channel: 'whatsapp', slug, to: normalized, variables, reference })
  const ok = res.status !== 'failed' && res.status !== 'skipped'
  if (res.status !== 'skipped') {
    const scope = currentReplyScope()
    logMessage({
      channel: 'whatsapp',
      to: normalized,
      from: 'messaging-service',
      body: res.body ?? `[${slug}]`,
      kind: slug.startsWith('otp/') ? 'otp' : slug,
      status: ok ? 'sent' : 'failed',
      error: res.error,
      providerSid: res.providerSid ?? null,
      provider: 'messaging-service',
      entityType: scope?.entityType,
      entityId: scope?.entityId,
    })
  }
  return ok
}

export async function sendOTPWhatsApp(p: { phone?: string | null; otp: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'otp/verify', { '1': p.otp })
}

export async function sendOrderConfirmedWhatsApp(p: { phone?: string | null; orderNumber: string; total: number }): Promise<boolean> {
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(p.total)
  return sendBySlug(p.phone, 'order/confirmed', { '1': p.orderNumber, '2': amount })
}

export async function sendOrderShippedWhatsApp(p: { phone?: string | null; orderNumber: string; courier?: string | null; trackingId?: string | null }): Promise<boolean> {
  const courier = p.courier || 'courier'
  const tracking = p.trackingId || (await orderUrlByNumber(p.orderNumber)) || `${await storeBaseUrlAsync()}/account/orders`
  return sendBySlug(p.phone, 'order/shipped', { '1': p.orderNumber, '2': courier, '3': tracking })
}

export async function sendOrderDeliveredWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/delivered', { '1': p.orderNumber })
}

export async function sendAccessGrantedWhatsApp(p: { phone?: string | null; orderNumber: string; vaultUrl: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/access-granted', { '1': p.orderNumber, '2': p.vaultUrl })
}

export async function sendOrderCancelledWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/cancelled', { '1': p.orderNumber })
}

export async function sendOutForDeliveryWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/out-for-delivery', { '1': p.orderNumber })
}

export async function sendPaymentFailedWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/payment-failed', { '1': p.orderNumber })
}

export async function sendPromoOfferWhatsApp(p: { phone?: string | null; headline: string; code: string; discount: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  return sendBySlug(p.phone, 'promo/offer', { '1': p.headline, '2': p.code, '3': p.discount }, p.entity?.entityId)
}
export async function sendNewArrivalsWhatsApp(p: { phone?: string | null; items: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'promo/new-arrivals', { '1': p.items })
}
export async function sendAbandonedCartWhatsApp(p: { phone?: string | null; items: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  return sendBySlug(p.phone, 'cart/abandoned', { '1': p.items }, p.entity?.entityId)
}
export async function sendBackInStockWhatsApp(p: { phone?: string | null; product: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  return sendBySlug(p.phone, 'restock', { '1': p.product }, p.entity?.entityId)
}
export async function sendFestiveGreetingWhatsApp(p: { phone?: string | null; festival: string; discount: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'promo/festive', { '1': p.festival, '2': p.discount })
}
export async function sendReorderReminderWhatsApp(p: { phone?: string | null; product: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'promo/reorder', { '1': p.product })
}

export async function sendSupportAckWhatsApp(p: { phone?: string | null }): Promise<boolean> {
  return sendBySlug(p.phone, 'support/ack', {})
}
export async function sendSupportTicketCreatedWhatsApp(p: { phone?: string | null; ticket: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'support/ticket-created', { '1': p.ticket })
}
export async function sendSupportReplyWhatsApp(p: { phone?: string | null; message: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'support/reply', { '1': p.message })
}
export async function sendSupportResolvedWhatsApp(p: { phone?: string | null; ticket: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'support/resolved', { '1': p.ticket })
}
export async function sendReturnInitiatedWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'return/initiated', { '1': p.orderNumber })
}
export async function sendRefundProcessedWhatsApp(p: { phone?: string | null; amount: string; orderNumber: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'refund/processed', { '1': p.amount, '2': p.orderNumber })
}
export async function sendFeedbackRequestWhatsApp(p: { phone?: string | null; orderNumber: string; url: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  return sendBySlug(p.phone, 'feedback/request', { '1': p.orderNumber, '2': p.url }, p.entity?.entityId)
}
export async function sendVariantChangeRequestedWhatsApp(p: { phone?: string | null; orderNumber: string; url: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/variant-change-requested', { '1': p.orderNumber, '2': p.url }, p.entity?.entityId)
}

export async function sendItemUnavailableWhatsApp(p: { phone?: string | null; orderNumber: string; item: string }): Promise<boolean> {
  // Meta rejects a parameter with newlines, tabs or more than 4 spaces in a row.
  const item = p.item.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 80)
  return sendBySlug(p.phone, 'order/out-of-stock', { '1': p.orderNumber, '2': item })
}

// Free-text WA (24h customer-service window) — bypasses templates; used for support replies.
export async function sendFreeTextWhatsApp(params: {
  phone?: string | null
  body: string
  kind?: string
}): Promise<boolean> {
  return !!(await sendWhatsAppDirect({ phone: params.phone, text: params.body, kind: params.kind }))
}

/**
 * One free-form WhatsApp message (text, or media with an optional caption) inside the 24h window,
 * through the channel gate, wallet gate and audit log. Returns the provider message id, or null
 * when not sent.
 */
export async function sendWhatsAppDirect(params: {
  phone?: string | null
  text?: string
  media?: OutboundMedia
  kind?: string
}): Promise<string | null> {
  const normalized = normalizePhone(params.phone)
  if (!normalized) return null
  if (!(await whatsappChannelEnabled())) return null
  if (!(await messagingGateAllows('whatsapp', false))) return null
  const provider = await getWhatsAppProvider()
  if (!provider.configured) return null
  const kind = params.kind || 'support_reply'
  const body = params.media ? params.media.caption || `[${params.media.filename || params.media.kind}]` : params.text || ''
  try {
    const sid = params.media ? await provider.sendMedia(normalized, params.media) : await provider.sendText(normalized, params.text || '')
    debitMessageEstimate({ channel: 'whatsapp', providerSid: sid }).catch(() => {})
    logMessage({ channel: 'whatsapp', to: normalized, from: provider.from, body, kind, status: 'sent', providerSid: sid, provider: provider.name, price: estimateFor('whatsapp'), deliveryStatus: 'estimated' })
    return sid
  } catch (err: any) {
    logMessage({ channel: 'whatsapp', to: normalized, from: provider.from, body, kind, status: 'failed', error: err?.message, provider: provider.name })
    return null
  }
}

/** Blue ticks on an inbound WhatsApp message (no-op where the provider can't). */
export async function markWhatsAppRead(providerMessageId: string): Promise<void> {
  try {
    await (await getWhatsAppProvider()).markRead(providerMessageId)
  } catch {
    /* best effort */
  }
}

export { normalizePhone as normalizeWhatsAppPhone }

export const WA_TEMPLATE_REGISTRY: Record<
  string,
  { label: string; category: 'marketing' | 'support'; fields: string[] }
> = {
  promo_offer: { label: 'Promo Offer', category: 'marketing', fields: ['headline', 'code', 'discount'] },
  new_arrivals: { label: 'New Arrivals', category: 'marketing', fields: ['items'] },
  abandoned_cart: { label: 'Abandoned Cart', category: 'marketing', fields: ['items'] },
  back_in_stock: { label: 'Back in Stock', category: 'marketing', fields: ['product'] },
  festive_greeting: { label: 'Festive Greeting', category: 'marketing', fields: ['festival', 'discount'] },
  reorder_reminder: { label: 'Reorder Reminder', category: 'marketing', fields: ['product'] },
  support_ticket_created: { label: 'Ticket Created', category: 'support', fields: ['ticket'] },
  support_reply: { label: 'Support Reply', category: 'support', fields: ['message'] },
  support_resolved: { label: 'Ticket Resolved', category: 'support', fields: ['ticket'] },
  return_initiated: { label: 'Return Initiated', category: 'support', fields: ['orderNumber'] },
  refund_processed: { label: 'Refund Processed', category: 'support', fields: ['amount', 'orderNumber'] },
  feedback_request: { label: 'Feedback Request', category: 'support', fields: ['orderNumber', 'url'] },
}

export async function sendTemplateByKey(
  phone: string | null | undefined,
  key: string,
  vars: Record<string, string>
): Promise<boolean> {
  switch (key) {
    case 'promo_offer': return sendPromoOfferWhatsApp({ phone, headline: vars.headline, code: vars.code, discount: vars.discount })
    case 'new_arrivals': return sendNewArrivalsWhatsApp({ phone, items: vars.items })
    case 'abandoned_cart': return sendAbandonedCartWhatsApp({ phone, items: vars.items })
    case 'back_in_stock': return sendBackInStockWhatsApp({ phone, product: vars.product })
    case 'festive_greeting': return sendFestiveGreetingWhatsApp({ phone, festival: vars.festival, discount: vars.discount })
    case 'reorder_reminder': return sendReorderReminderWhatsApp({ phone, product: vars.product })
    case 'support_ticket_created': return sendSupportTicketCreatedWhatsApp({ phone, ticket: vars.ticket })
    case 'support_reply': return sendSupportReplyWhatsApp({ phone, message: vars.message })
    case 'support_resolved': return sendSupportResolvedWhatsApp({ phone, ticket: vars.ticket })
    case 'return_initiated': return sendReturnInitiatedWhatsApp({ phone, orderNumber: vars.orderNumber })
    case 'refund_processed': return sendRefundProcessedWhatsApp({ phone, amount: vars.amount, orderNumber: vars.orderNumber })
    case 'feedback_request': return sendFeedbackRequestWhatsApp({ phone, orderNumber: vars.orderNumber, url: vars.url })
    default: return false
  }
}
