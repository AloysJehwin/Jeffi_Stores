import { logMessage } from '@/lib/shared/message-log'
import { storeBaseUrlAsync, storeSignature } from '@/lib/catalog/brand'
import { orderUrlByNumber } from '@/lib/shared/customer-links'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { getWhatsAppProvider } from '@/lib/shared/messaging'
import { messagingGateAllows, debitMessageEstimate } from '@/lib/shared/messaging/billing'
import { estimateFor } from '@/lib/shared/messaging/pricing'
import { sendByTemplate } from '@/lib/shared/send-by-template'

// WhatsApp wrappers now dispatch via sendByTemplate (slug → messaging-service).
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
  return res.status !== 'failed' && res.status !== 'skipped'
}

// Campaign-chosen approved template (direct SID path, bypasses slug library).
export async function sendCampaignTemplateWhatsApp(params: {
  phone?: string | null
  sidEnvVar: string
  variables: Record<string, string>
  headerImageUrl?: string | null
  imageSlot?: number | null
  kind: string
  entity?: { entityType?: string; entityId?: string }
}): Promise<boolean> {
  const contentSid = process.env[params.sidEnvVar] || ''
  if (!contentSid) return false
  const normalized = normalizePhone(params.phone)
  if (!normalized) return false
  if (!(await whatsappChannelEnabled())) return false
  if (!(await messagingGateAllows('whatsapp', true))) return false
  const vars: Record<string, string> = { ...params.variables }
  if (params.headerImageUrl && params.imageSlot != null) vars[String(params.imageSlot)] = params.headerImageUrl
  const provider = await getWhatsAppProvider()
  if (!provider.configured) return false
  const summary = `WhatsApp: ${params.kind}`
  try {
    const sid = await provider.sendTemplate(normalized, contentSid, vars)
    debitMessageEstimate({ channel: 'whatsapp', providerSid: sid }).catch(() => {})
    logMessage({ channel: 'whatsapp', to: normalized, from: provider.from, body: summary, kind: params.kind, status: 'sent', providerSid: sid, entityType: params.entity?.entityType, entityId: params.entity?.entityId, provider: provider.name, price: estimateFor('whatsapp'), deliveryStatus: 'estimated' })
    return true
  } catch (err: any) {
    logMessage({ channel: 'whatsapp', to: normalized, from: provider.from, body: summary, kind: params.kind, status: 'failed', error: err?.message, entityType: params.entity?.entityType, entityId: params.entity?.entityId, provider: provider.name })
    return false
  }
}

export async function sendOTPWhatsApp(p: { phone?: string | null; otp: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'otp/verify', { '1': p.otp, '2': 10 })
}

export async function sendOrderConfirmedWhatsApp(p: { phone?: string | null; orderNumber: string; total: number }): Promise<boolean> {
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(p.total)
  const url = (await orderUrlByNumber(p.orderNumber)) || `${await storeBaseUrlAsync()}/account/orders`
  return sendBySlug(p.phone, 'order/confirmed', { '1': p.orderNumber, '2': amount, '3': url })
}

export async function sendOrderShippedWhatsApp(p: { phone?: string | null; orderNumber: string; courier?: string | null; trackingId?: string | null }): Promise<boolean> {
  const courier = p.courier || 'courier'
  const tracking = p.trackingId || (await orderUrlByNumber(p.orderNumber)) || `${await storeBaseUrlAsync()}/account/orders`
  return sendBySlug(p.phone, 'order/shipped', { '1': p.orderNumber, '2': courier, '3': tracking, '4': tracking })
}

export async function sendOrderDeliveredWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  const url = (await orderUrlByNumber(p.orderNumber)) || `${await storeBaseUrlAsync()}/account/orders`
  return sendBySlug(p.phone, 'order/delivered', { '1': p.orderNumber, '2': url })
}

export async function sendAccessGrantedWhatsApp(p: { phone?: string | null; orderNumber: string; vaultUrl: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/access-granted', { '1': p.orderNumber, '2': p.vaultUrl })
}

export async function sendOrderCancelledWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/cancelled', { '1': p.orderNumber, '2': '' })
}

export async function sendOutForDeliveryWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/out-for-delivery', { '1': p.orderNumber, '2': '' })
}

export async function sendPaymentFailedWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'order/payment-failed', { '1': p.orderNumber })
}

export async function sendPromoOfferWhatsApp(p: { phone?: string | null; headline: string; code: string; discount: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendBySlug(p.phone, 'promo/offer', { '1': STORE, '2': p.discount, '3': p.code, '4': '', '5': p.headline }, p.entity?.entityId)
}
export async function sendNewArrivalsWhatsApp(p: { phone?: string | null; items: string }): Promise<boolean> {
  return sendBySlug(p.phone, 'promo/new-arrivals', { '1': p.items })
}
export async function sendAbandonedCartWhatsApp(p: { phone?: string | null; items: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendBySlug(p.phone, 'cart/abandoned', { '1': STORE, '2': p.items, '3': '' }, p.entity?.entityId)
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

// Free-text WA (24h customer-service window) — bypasses templates; used for support replies.
export async function sendFreeTextWhatsApp(params: {
  phone?: string | null
  body: string
  kind?: string
}): Promise<boolean> {
  const normalized = normalizePhone(params.phone)
  if (!normalized) return false
  if (!(await whatsappChannelEnabled())) return false
  if (!(await messagingGateAllows('whatsapp', false))) return false
  const provider = await getWhatsAppProvider()
  if (!provider.configured) return false
  const kind = params.kind || 'support_reply'
  try {
    const sid = await provider.sendText(normalized, params.body)
    debitMessageEstimate({ channel: 'whatsapp', providerSid: sid }).catch(() => {})
    logMessage({ channel: 'whatsapp', to: normalized, from: provider.from, body: params.body, kind, status: 'sent', providerSid: sid, provider: provider.name, price: estimateFor('whatsapp'), deliveryStatus: 'estimated' })
    return true
  } catch (err: any) {
    logMessage({ channel: 'whatsapp', to: normalized, from: provider.from, body: params.body, kind, status: 'failed', error: err?.message, provider: provider.name })
    return false
  }
}

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
