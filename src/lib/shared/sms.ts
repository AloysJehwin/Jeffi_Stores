import twilio from 'twilio'
import { logMessage } from '@/lib/shared/message-log'
import { storeSignature } from '@/lib/catalog/brand'

// Twilio SMS client — initialized lazily so missing creds don't crash the app.
// Set TWILIO_ACCOUNT_SID + TWILIO_FROM_NUMBER, plus EITHER:
//   - TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (preferred — revocable API key), OR
//   - TWILIO_AUTH_TOKEN (account auth token).
// Set SMS_DISABLED=true to suppress all sends (useful in dev/test).

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const API_KEY_SID = process.env.TWILIO_API_KEY_SID
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '+18722179910'
const DISABLED = process.env.SMS_DISABLED === 'true'

function getClient() {
  if (!ACCOUNT_SID) return null
  // Prefer API key auth (revocable) when available; fall back to account auth token.
  if (API_KEY_SID && API_KEY_SECRET) {
    return twilio(API_KEY_SID, API_KEY_SECRET, { accountSid: ACCOUNT_SID })
  }
  if (AUTH_TOKEN) return twilio(ACCOUNT_SID, AUTH_TOKEN)
  return null
}

// Normalize Indian mobile numbers to E.164 format (+91XXXXXXXXXX).
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 13 && digits.startsWith('091')) return `+91${digits.slice(3)}`
  if (phone.trim().startsWith('+')) return phone.trim()
  return null
}

// `kind` labels the message for the audit log. 'otp' is never persisted.
async function sendSMS(to: string | null | undefined, body: string, kind: string): Promise<boolean> {
  const normalized = normalizePhone(to)
  if (!normalized) return false
  if (DISABLED) return false
  const client = getClient()
  if (!client) return false
  try {
    const msg = await client.messages.create({ from: FROM_NUMBER, to: normalized, body })
    logMessage({ channel: 'sms', to: normalized, from: FROM_NUMBER, body, kind, status: 'sent', providerSid: msg.sid })
    return true
  } catch (err: any) {
    logMessage({ channel: 'sms', to: normalized, from: FROM_NUMBER, body, kind, status: 'failed', error: err?.message })
    return false
  }
}

// ── Notification templates ────────────────────────────────────────────────────

export async function sendOrderConfirmedSMS(params: {
  phone?: string | null
  orderNumber: string
  total: number
}): Promise<boolean> {
  const amount = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(params.total)
  const { name: STORE_NAME, web: STORE_WEB } = await storeSignature()
  return sendSMS(
    params.phone,
    `${STORE_NAME}: Your order ${params.orderNumber} is confirmed! Total: ${amount}. Track at ${STORE_WEB}/orders.`,
    'order_confirmed'
  )
}

export async function sendOrderShippedSMS(params: {
  phone?: string | null
  orderNumber: string
  trackingId?: string | null
  courier?: string | null
}): Promise<boolean> {
  const tracking = params.trackingId ? ` Tracking: ${params.trackingId}.` : ''
  const courier = params.courier ? ` via ${params.courier}` : ''
  const { name: STORE_NAME, web: STORE_WEB } = await storeSignature()
  return sendSMS(
    params.phone,
    `${STORE_NAME}: Your order ${params.orderNumber} has been shipped${courier}!${tracking} Track at ${STORE_WEB}/orders.`,
    'order_shipped'
  )
}

export async function sendOrderDeliveredSMS(params: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  const { name: STORE_NAME, web: STORE_WEB } = await storeSignature()
  return sendSMS(
    params.phone,
    `${STORE_NAME}: Your order ${params.orderNumber} has been delivered. Thank you for shopping with us! Shop again at ${STORE_WEB}.`,
    'order_delivered'
  )
}

export async function sendOrderCancelledSMS(params: {
  phone?: string | null
  orderNumber: string
  reason?: string | null
}): Promise<boolean> {
  const reason = params.reason ? ` Reason: ${params.reason}.` : ''
  const { name: STORE_NAME, web: STORE_WEB } = await storeSignature()
  return sendSMS(
    params.phone,
    `${STORE_NAME}: Your order ${params.orderNumber} has been cancelled.${reason} For help, visit ${STORE_WEB}/support.`,
    'order_cancelled'
  )
}

export async function sendOTPSMS(params: { phone?: string | null; otp: string }): Promise<boolean> {
  const { name: STORE_NAME } = await storeSignature()
  return sendSMS(
    params.phone,
    `${STORE_NAME}: Your OTP is ${params.otp}. Valid for 10 minutes. Do not share this with anyone.`,
    'otp'
  )
}

export async function sendVariantChangeRequestedSMS(params: {
  phone?: string | null
  orderNumber: string
  orderUrl: string
}): Promise<boolean> {
  const { name: STORE_NAME } = await storeSignature()
  return sendSMS(
    params.phone,
    `${STORE_NAME}: Order ${params.orderNumber} needs your approval for a variant change. Review & confirm: ${params.orderUrl}`,
    'variant_change_requested'
  )
}

export async function sendPaymentFailedSMS(params: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  const { name: STORE_NAME, web: STORE_WEB } = await storeSignature()
  return sendSMS(
    params.phone,
    `${STORE_NAME}: Payment for order ${params.orderNumber} failed. Please retry at ${STORE_WEB}/orders or contact support.`,
    'payment_failed'
  )
}

export async function sendOutForDeliverySMS(params: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  const { name: STORE_NAME } = await storeSignature()
  return sendSMS(
    params.phone,
    `${STORE_NAME}: Great news! Your order ${params.orderNumber} is out for delivery today. Please be available.`,
    'out_for_delivery'
  )
}
