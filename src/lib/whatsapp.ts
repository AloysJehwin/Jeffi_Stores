import twilio from 'twilio'

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
  variables: Record<string, string>
): Promise<boolean> {
  const normalized = normalizePhone(to)
  if (!normalized) return false
  if (DISABLED) return false
  const client = getClient()
  if (!client) return false
  try {
    await client.messages.create({
      from: `whatsapp:${WA_FROM}`,
      to: `whatsapp:${normalized}`,
      contentSid,
      contentVariables: JSON.stringify(variables),
    })
    return true
  } catch {
    return false
  }
}

export async function sendOTPWhatsApp(params: { phone?: string | null; otp: string }): Promise<boolean> {
  return sendTemplate(params.phone, TEMPLATES.otp, { '1': params.otp })
}

export async function sendOrderConfirmedWhatsApp(params: {
  phone?: string | null; orderNumber: string; total: number
}): Promise<boolean> {
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(params.total)
  return sendTemplate(params.phone, TEMPLATES.orderConfirmed, { '1': params.orderNumber, '2': amount })
}

export async function sendOrderShippedWhatsApp(params: {
  phone?: string | null; orderNumber: string; courier?: string | null; trackingId?: string | null
}): Promise<boolean> {
  return sendTemplate(params.phone, TEMPLATES.orderShipped, {
    '1': params.orderNumber,
    '2': params.courier || 'courier',
    '3': params.trackingId || 'jeffistores.in/orders',
  })
}

export async function sendOrderDeliveredWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  return sendTemplate(params.phone, TEMPLATES.orderDelivered, { '1': params.orderNumber })
}

export async function sendOrderCancelledWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  return sendTemplate(params.phone, TEMPLATES.orderCancelled, { '1': params.orderNumber })
}

export async function sendOutForDeliveryWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  return sendTemplate(params.phone, TEMPLATES.outForDelivery, { '1': params.orderNumber })
}
