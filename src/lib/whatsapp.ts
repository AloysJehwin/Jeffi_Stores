import twilio from 'twilio'
import { logMessage } from '@/lib/message-log'

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
}

function getClient() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return null
  return twilio(ACCOUNT_SID, AUTH_TOKEN)
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
  summary: string
): Promise<boolean> {
  const normalized = normalizePhone(to)
  if (!normalized) return false
  if (DISABLED) return false
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
    logMessage({ channel: 'whatsapp', to: normalized, from: WA_FROM, body: summary, kind, status: 'sent', providerSid: msg.sid })
    return true
  } catch (err: any) {
    logMessage({ channel: 'whatsapp', to: normalized, from: WA_FROM, body: summary, kind, status: 'failed', error: err?.message })
    return false
  }
}

const STORE = 'Jeffi Stores'

export async function sendOTPWhatsApp(params: { phone?: string | null; otp: string }): Promise<boolean> {
  return sendTemplate(params.phone, TEMPLATES.otp, { '1': params.otp }, 'otp',
    `${STORE}: Your verification code is ${params.otp}.`)
}

export async function sendOrderConfirmedWhatsApp(params: {
  phone?: string | null; orderNumber: string; total: number
}): Promise<boolean> {
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(params.total)
  return sendTemplate(params.phone, TEMPLATES.orderConfirmed, { '1': params.orderNumber, '2': amount }, 'order_confirmed',
    `${STORE}: Your order ${params.orderNumber} is confirmed! Total: ${amount}.`)
}

export async function sendOrderShippedWhatsApp(params: {
  phone?: string | null; orderNumber: string; courier?: string | null; trackingId?: string | null
}): Promise<boolean> {
  const courier = params.courier || 'courier'
  const tracking = params.trackingId || 'jeffistores.in/orders'
  return sendTemplate(params.phone, TEMPLATES.orderShipped, {
    '1': params.orderNumber,
    '2': courier,
    '3': tracking,
  }, 'order_shipped', `${STORE}: Your order ${params.orderNumber} has been shipped via ${courier}. Tracking: ${tracking}.`)
}

export async function sendOrderDeliveredWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  return sendTemplate(params.phone, TEMPLATES.orderDelivered, { '1': params.orderNumber }, 'order_delivered',
    `${STORE}: Your order ${params.orderNumber} has been delivered.`)
}

export async function sendOrderCancelledWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  return sendTemplate(params.phone, TEMPLATES.orderCancelled, { '1': params.orderNumber }, 'order_cancelled',
    `${STORE}: Your order ${params.orderNumber} has been cancelled.`)
}

export async function sendOutForDeliveryWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  return sendTemplate(params.phone, TEMPLATES.outForDelivery, { '1': params.orderNumber }, 'out_for_delivery',
    `${STORE}: Your order ${params.orderNumber} is out for delivery today.`)
}

export async function sendPaymentFailedWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  // No dedicated payment-failed template yet; skip unless configured.
  if (!TEMPLATES.paymentFailed) return false
  return sendTemplate(params.phone, TEMPLATES.paymentFailed, { '1': params.orderNumber }, 'payment_failed',
    `${STORE}: Payment for order ${params.orderNumber} failed.`)
}
