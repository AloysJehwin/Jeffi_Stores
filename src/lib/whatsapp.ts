import twilio from 'twilio'
import { logMessage } from '@/lib/message-log'
import { storeSignature } from '@/lib/brand'

// WhatsApp notifications via Twilio (Meta BSP).
// Business-initiated WhatsApp messages must use approved Content Templates
// (contentSid + contentVariables), NOT free-form text — WhatsApp only allows
// free text within a 24h customer-service window.
//
// Content template SIDs are created in Twilio and approved by Meta.
// Override any SID via env (e.g. TWILIO_WA_OTP_SID) to swap templates without a deploy.
//
// Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN in env.
// Set TWILIO_WHATSAPP_FROM to override the sender (defaults to +18722179910).
// Set WHATSAPP_DISABLED=true to suppress all sends.

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const API_KEY_SID = process.env.TWILIO_API_KEY_SID
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET
const WA_FROM = process.env.TWILIO_WHATSAPP_FROM || '+18722179910'
const DISABLED = process.env.WHATSAPP_DISABLED === 'true'

const TEMPLATES = {
  otp: process.env.TWILIO_WA_OTP_SID || 'HX8efbe15a7d9c7cf152fd65874e6ac240',
  orderConfirmed: process.env.TWILIO_WA_ORDER_CONFIRMED_SID || 'HXb817cebc70c7d8658a4cb5a9b1126208',
  orderShipped: process.env.TWILIO_WA_ORDER_SHIPPED_SID || 'HX1a387a882358cf55cc4be47a1ec76129',
  orderDelivered: process.env.TWILIO_WA_ORDER_DELIVERED_SID || 'HX3d1393a9898a8d9e87c0dbc55497a6af',
  orderCancelled: process.env.TWILIO_WA_ORDER_CANCELLED_SID || 'HX05b47f8c139e462a443a428af823f8dc',
  outForDelivery: process.env.TWILIO_WA_OUT_FOR_DELIVERY_SID || 'HXfa11093ed4bc99a14151f8b3bc90b749',
  paymentFailed: process.env.TWILIO_WA_PAYMENT_FAILED_SID || '',
  // Marketing
  promoOffer: process.env.TWILIO_WA_PROMO_OFFER_SID || 'HX4500f4beac783d988ccaea62396927a3',
  newArrivals: process.env.TWILIO_WA_NEW_ARRIVALS_SID || 'HXe16b084ecee38483663765275d3afd20',
  abandonedCart: process.env.TWILIO_WA_ABANDONED_CART_SID || 'HX3b662d590c448e238ee4d6d4d638ef24',
  backInStock: process.env.TWILIO_WA_BACK_IN_STOCK_SID || 'HXd4d3cf0ced879c6fb2397e25d21805f6',
  festiveGreeting: process.env.TWILIO_WA_FESTIVE_GREETING_SID || 'HX5c3fad2143bddcd9709c5e4ffc7a5564',
  reorderReminder: process.env.TWILIO_WA_REORDER_REMINDER_SID || 'HX1f3a4b0168671e57ff5f54c9dd155984',
  // Support
  supportAck: process.env.TWILIO_WA_SUPPORT_ACK_SID || 'HX95ce2cea26825b06e22b24aa802dddf8',
  supportTicketCreated: process.env.TWILIO_WA_SUPPORT_TICKET_SID || 'HX3fee423887ba430b9d9c83f78ba6a2bb',
  supportReply: process.env.TWILIO_WA_SUPPORT_REPLY_SID || 'HX16911ee6dd59658012abcc99d5a7d61a',
  supportResolved: process.env.TWILIO_WA_SUPPORT_RESOLVED_SID || 'HXde26b207aff33bb29e4f420ac1f1f9fb',
  returnInitiated: process.env.TWILIO_WA_RETURN_INITIATED_SID || 'HX7b0dfa4a553817d5a14d3920d7beb3c4',
  refundProcessed: process.env.TWILIO_WA_REFUND_PROCESSED_SID || 'HX97f829b9e7f9222341e3c5ab3a861205',
  feedbackRequest: process.env.TWILIO_WA_FEEDBACK_REQUEST_SID || 'HX4f34db44ae6e5e4c31c0048745cafb82',
  // Post-order variant change — needs a Meta-approved template with {1}=order, {2}=url.
  // Set TWILIO_WA_VARIANT_CHANGE_SID once approved; until then sendTemplate's
  // freeform fallback text (below) carries the message within the 24h window,
  // and the notify.ts dispatcher falls back to SMS if WhatsApp returns false.
  variantChange: process.env.TWILIO_WA_VARIANT_CHANGE_SID || '',
}

function getClient() {
  if (!ACCOUNT_SID) return null
  if (API_KEY_SID && API_KEY_SECRET) {
    return twilio(API_KEY_SID, API_KEY_SECRET, { accountSid: ACCOUNT_SID })
  }
  if (AUTH_TOKEN) return twilio(ACCOUNT_SID, AUTH_TOKEN)
  return null
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

async function sendTemplate(
  to: string | null | undefined,
  contentSid: string,
  variables: Record<string, string>,
  kind: string,
  summary: string,
  entity?: { entityType?: string; entityId?: string }
): Promise<boolean> {
  const normalized = normalizePhone(to)
  if (!normalized) return false
  if (DISABLED) return false
  if (!contentSid) return false  // template not configured yet → let caller fall back (SMS)
  const client = getClient()
  if (!client) return false
  const waFrom = `whatsapp:${WA_FROM}`
  try {
    const msg = await client.messages.create({
      from: waFrom,
      to: `whatsapp:${normalized}`,
      contentSid,
      contentVariables: JSON.stringify(variables),
    })
    logMessage({ channel: 'whatsapp', to: normalized, from: WA_FROM, body: summary, kind, status: 'sent', providerSid: msg.sid, entityType: entity?.entityType, entityId: entity?.entityId })
    return true
  } catch (err: any) {
    logMessage({ channel: 'whatsapp', to: normalized, from: WA_FROM, body: summary, kind, status: 'failed', error: err?.message, entityType: entity?.entityType, entityId: entity?.entityId })
    return false
  }
}

export async function sendOTPWhatsApp(params: { phone?: string | null; otp: string }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(params.phone, TEMPLATES.otp, { '1': params.otp }, 'otp',
    `${STORE}: Your verification code is ${params.otp}.`)
}

export async function sendOrderConfirmedWhatsApp(params: {
  phone?: string | null; orderNumber: string; total: number
}): Promise<boolean> {
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(params.total)
  const { name: STORE } = await storeSignature()
  return sendTemplate(params.phone, TEMPLATES.orderConfirmed, { '1': params.orderNumber, '2': amount }, 'order_confirmed',
    `${STORE}: Your order ${params.orderNumber} is confirmed! Total: ${amount}.`)
}

export async function sendOrderShippedWhatsApp(params: {
  phone?: string | null; orderNumber: string; courier?: string | null; trackingId?: string | null
}): Promise<boolean> {
  const courier = params.courier || 'courier'
  const tracking = params.trackingId || 'jeffistores.in/orders'
  const { name: STORE } = await storeSignature()
  return sendTemplate(params.phone, TEMPLATES.orderShipped, {
    '1': params.orderNumber,
    '2': courier,
    '3': tracking,
  }, 'order_shipped', `${STORE}: Your order ${params.orderNumber} has been shipped via ${courier}. Tracking: ${tracking}.`)
}

export async function sendOrderDeliveredWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(params.phone, TEMPLATES.orderDelivered, { '1': params.orderNumber }, 'order_delivered',
    `${STORE}: Your order ${params.orderNumber} has been delivered.`)
}

export async function sendOrderCancelledWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(params.phone, TEMPLATES.orderCancelled, { '1': params.orderNumber }, 'order_cancelled',
    `${STORE}: Your order ${params.orderNumber} has been cancelled.`)
}

export async function sendOutForDeliveryWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(params.phone, TEMPLATES.outForDelivery, { '1': params.orderNumber }, 'out_for_delivery',
    `${STORE}: Your order ${params.orderNumber} is out for delivery today.`)
}

export async function sendPaymentFailedWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  // No dedicated payment-failed template yet; skip unless configured.
  if (!TEMPLATES.paymentFailed) return false
  const { name: STORE } = await storeSignature()
  return sendTemplate(params.phone, TEMPLATES.paymentFailed, { '1': params.orderNumber }, 'payment_failed',
    `${STORE}: Payment for order ${params.orderNumber} failed.`)
}

// ── Marketing ──────────────────────────────────────────────────────────────

export async function sendPromoOfferWhatsApp(p: { phone?: string | null; headline: string; code: string; discount: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.promoOffer, { '1': p.headline, '2': p.code, '3': p.discount }, 'promo_offer',
    `${STORE}: ${p.headline}! Use code ${p.code} for ${p.discount} off.`, p.entity)
}
export async function sendNewArrivalsWhatsApp(p: { phone?: string | null; items: string }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.newArrivals, { '1': p.items }, 'new_arrivals',
    `${STORE}: New arrivals — ${p.items} now in stock.`)
}
export async function sendAbandonedCartWhatsApp(p: { phone?: string | null; items: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.abandonedCart, { '1': p.items }, 'abandoned_cart',
    `${STORE}: You left ${p.items} in your cart.`, p.entity)
}
export async function sendBackInStockWhatsApp(p: { phone?: string | null; product: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.backInStock, { '1': p.product }, 'back_in_stock',
    `${STORE}: ${p.product} is back in stock.`, p.entity)
}
export async function sendFestiveGreetingWhatsApp(p: { phone?: string | null; festival: string; discount: string }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.festiveGreeting, { '1': p.festival, '2': p.discount }, 'festive_greeting',
    `${STORE}: ${p.festival} wishes! Enjoy ${p.discount} off storewide.`)
}
export async function sendReorderReminderWhatsApp(p: { phone?: string | null; product: string }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.reorderReminder, { '1': p.product }, 'reorder_reminder',
    `${STORE}: Running low on ${p.product}? Reorder now.`)
}

// ── Support ────────────────────────────────────────────────────────────────

export async function sendSupportAckWhatsApp(p: { phone?: string | null }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.supportAck, {}, 'support_ack',
    `${STORE}: We received your message and an agent will reply shortly.`)
}
export async function sendSupportTicketCreatedWhatsApp(p: { phone?: string | null; ticket: string }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.supportTicketCreated, { '1': p.ticket }, 'support_ticket_created',
    `${STORE}: Your support request #${p.ticket} is registered.`)
}
export async function sendSupportReplyWhatsApp(p: { phone?: string | null; message: string }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.supportReply, { '1': p.message }, 'support_reply',
    `${STORE} support: ${p.message}`)
}
export async function sendSupportResolvedWhatsApp(p: { phone?: string | null; ticket: string }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.supportResolved, { '1': p.ticket }, 'support_resolved',
    `${STORE}: Your support request #${p.ticket} is resolved.`)
}
export async function sendReturnInitiatedWhatsApp(p: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.returnInitiated, { '1': p.orderNumber }, 'return_initiated',
    `${STORE}: Your return for order ${p.orderNumber} has been initiated.`)
}
export async function sendRefundProcessedWhatsApp(p: { phone?: string | null; amount: string; orderNumber: string }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.refundProcessed, { '1': p.amount, '2': p.orderNumber }, 'refund_processed',
    `${STORE}: A refund of ${p.amount} for order ${p.orderNumber} has been processed.`)
}
export async function sendFeedbackRequestWhatsApp(p: { phone?: string | null; orderNumber: string; url: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.feedbackRequest, { '1': p.orderNumber, '2': p.url }, 'feedback_request',
    `${STORE}: How was your order ${p.orderNumber}? Share feedback at ${p.url}.`, p.entity)
}
export async function sendVariantChangeRequestedWhatsApp(p: { phone?: string | null; orderNumber: string; url: string; entity?: { entityType?: string; entityId?: string } }): Promise<boolean> {
  const { name: STORE } = await storeSignature()
  return sendTemplate(p.phone, TEMPLATES.variantChange, { '1': p.orderNumber, '2': p.url }, 'variant_change_requested',
    `${STORE}: Order ${p.orderNumber} needs your approval for a variant change. Review & confirm: ${p.url}`, p.entity)
}

// ── Free-text (only delivers within the 24h customer-service window) ─────────
// Used for support replies after a customer has messaged first. Outside the
// window Meta blocks it and this returns false (caller should fall back to a template).
export async function sendFreeTextWhatsApp(params: { phone?: string | null; body: string; kind?: string }): Promise<boolean> {
  const normalized = normalizePhone(params.phone)
  if (!normalized) return false
  if (DISABLED) return false
  const client = getClient()
  if (!client) return false
  const waFrom = `whatsapp:${WA_FROM}`
  const kind = params.kind || 'support_reply'
  try {
    const msg = await client.messages.create({ from: waFrom, to: `whatsapp:${normalized}`, body: params.body })
    logMessage({ channel: 'whatsapp', to: normalized, from: WA_FROM, body: params.body, kind, status: 'sent', providerSid: msg.sid })
    return true
  } catch (err: any) {
    logMessage({ channel: 'whatsapp', to: normalized, from: WA_FROM, body: params.body, kind, status: 'failed', error: err?.message })
    return false
  }
}

// Registry of send-from-UI templates for the admin WhatsApp Engagement card.
// Each entry: the label + the variable fields the admin must fill.
export const WA_TEMPLATE_REGISTRY: Record<string, { label: string; category: 'marketing' | 'support'; fields: string[] }> = {
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

// Dispatch a registry template by key with a variables object (used by the engagement API).
export async function sendTemplateByKey(phone: string | null | undefined, key: string, vars: Record<string, string>): Promise<boolean> {
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
