import twilio from 'twilio'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const API_KEY_SID = process.env.TWILIO_API_KEY_SID
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET
const SMS_FROM = process.env.TWILIO_FROM_NUMBER || ''
const WA_FROM = process.env.TWILIO_WHATSAPP_FROM || ''

function client() {
  if (!ACCOUNT_SID) return null
  if (API_KEY_SID && API_KEY_SECRET) return twilio(API_KEY_SID, API_KEY_SECRET, { accountSid: ACCOUNT_SID })
  if (AUTH_TOKEN) return twilio(ACCOUNT_SID, AUTH_TOKEN)
  return null
}
export const twilioConfigured = () => client() !== null

export function normalizePhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) return d
  if (d.length === 10) return '+91' + d
  if (d.length === 12 && d.startsWith('91')) return '+' + d
  return '+' + d
}

function callback(messageId: string) {
  const base = process.env.PUBLIC_BASE_URL
  // Twilio rejects the whole send for a non-public callback (http://…localhost in dev).
  if (!base || !/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) return undefined
  return `${base.replace(/\/$/, '')}/webhooks/twilio/status?m=${messageId}`
}

export async function sendSms(o: { to: string; body: string; messageId: string }): Promise<string> {
  const c = client()
  if (!c || !SMS_FROM) throw new Error('Twilio SMS not configured')
  const m = await c.messages.create({ from: SMS_FROM, to: normalizePhone(o.to), body: o.body, statusCallback: callback(o.messageId) })
  return m.sid
}

export async function sendWhatsApp(o: {
  to: string
  body?: string
  contentSid?: string
  variables?: Record<string, string>
  messageId: string
}): Promise<string> {
  const c = client()
  if (!c || !WA_FROM) throw new Error('Twilio WhatsApp not configured')
  const base = { from: `whatsapp:${WA_FROM}`, to: `whatsapp:${normalizePhone(o.to)}`, statusCallback: callback(o.messageId) }
  const m = o.contentSid
    ? await c.messages.create({ ...base, contentSid: o.contentSid, contentVariables: JSON.stringify(o.variables ?? {}) })
    : await c.messages.create({ ...base, body: o.body ?? '' })
  return m.sid
}

/** Twilio reports price as a negative USD string on the status callback. */
export function priceUsd(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? Math.abs(n) : null
}
