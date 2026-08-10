// Meta WhatsApp Cloud API — notification sender.
// Requires META_PHONE_NUMBER_ID and META_ACCESS_TOKEN in env.
// All functions fail silently (return false) when env vars are missing.
//
// Template names below must match approved templates in Meta Business Manager.
// Set META_WA_TEMPLATES_APPROVED=true once templates are approved — until then
// all template-based sends are skipped and only the OTP text fallback is used.

const META_PHONE_ID = process.env.META_PHONE_NUMBER_ID
const META_TOKEN = process.env.META_ACCESS_TOKEN
const TEMPLATES_APPROVED = process.env.META_WA_TEMPLATES_APPROVED === 'true'

const TEMPLATES = {
  otp: 'jeffi_otp',
  orderConfirmed: 'jeffi_order_confirmed',
  orderShipped: 'jeffi_order_shipped',
  orderDelivered: 'jeffi_order_delivered',
  orderCancelled: 'jeffi_order_cancelled',
  outForDelivery: 'jeffi_out_for_delivery',
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 13 && digits.startsWith('091')) return `+91${digits.slice(3)}`
  return null
}

async function send(to: string, body: object): Promise<boolean> {
  if (!META_PHONE_ID || !META_TOKEN) return false
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${META_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...body }),
    })
    return res.ok
  } catch {
    return false
  }
}

function templateMessage(name: string, langCode: string, params: string[]): object {
  return {
    type: 'template',
    template: {
      name,
      language: { code: langCode },
      components: params.length ? [{
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: p })),
      }] : [],
    },
  }
}

// OTP — uses text fallback until jeffi_otp template is approved
export async function sendOTPWhatsApp(params: { phone?: string | null; otp: string }): Promise<boolean> {
  const to = normalizePhone(params.phone)
  if (!to) return false
  if (TEMPLATES_APPROVED) {
    return send(to, templateMessage(TEMPLATES.otp, 'en', [params.otp]))
  }
  // Fallback: plain text (only works for numbers that have messaged the business first)
  return send(to, {
    type: 'text',
    text: { body: `Jeffi Stores: Your OTP is ${params.otp}. Valid for 10 minutes. Do not share this with anyone.` },
  })
}

export async function sendOrderConfirmedWhatsApp(params: {
  phone?: string | null; orderNumber: string; total: number
}): Promise<boolean> {
  if (!TEMPLATES_APPROVED) return false
  const to = normalizePhone(params.phone)
  if (!to) return false
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(params.total)
  return send(to, templateMessage(TEMPLATES.orderConfirmed, 'en', [params.orderNumber, amount]))
}

export async function sendOrderShippedWhatsApp(params: {
  phone?: string | null; orderNumber: string; courier?: string | null; trackingId?: string | null
}): Promise<boolean> {
  if (!TEMPLATES_APPROVED) return false
  const to = normalizePhone(params.phone)
  if (!to) return false
  return send(to, templateMessage(TEMPLATES.orderShipped, 'en', [
    params.orderNumber,
    params.courier || 'courier',
    params.trackingId || 'jeffistores.in/orders',
  ]))
}

export async function sendOrderDeliveredWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  if (!TEMPLATES_APPROVED) return false
  const to = normalizePhone(params.phone)
  if (!to) return false
  return send(to, templateMessage(TEMPLATES.orderDelivered, 'en', [params.orderNumber]))
}

export async function sendOrderCancelledWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  if (!TEMPLATES_APPROVED) return false
  const to = normalizePhone(params.phone)
  if (!to) return false
  return send(to, templateMessage(TEMPLATES.orderCancelled, 'en', [params.orderNumber]))
}

export async function sendOutForDeliveryWhatsApp(params: {
  phone?: string | null; orderNumber: string
}): Promise<boolean> {
  if (!TEMPLATES_APPROVED) return false
  const to = normalizePhone(params.phone)
  if (!to) return false
  return send(to, templateMessage(TEMPLATES.outForDelivery, 'en', [params.orderNumber]))
}
