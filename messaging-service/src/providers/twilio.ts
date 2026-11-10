import twilio from 'twilio'
import type { SenderOverride } from './senders.js'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const API_KEY_SID = process.env.TWILIO_API_KEY_SID
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET
const SMS_FROM = process.env.TWILIO_FROM_NUMBER || ''
const WA_FROM = process.env.TWILIO_WHATSAPP_FROM || ''

// A store's own Twilio account (tenant_messaging_senders) builds a per-call client; the platform env otherwise.
function client(ov?: SenderOverride) {
  const c = ov?.config
  const sid = c ? c.account_sid : ACCOUNT_SID
  if (!sid) return null
  const [keySid, keySecret, token] = c ? [c.api_key_sid, c.api_key_secret, c.auth_token] : [API_KEY_SID, API_KEY_SECRET, AUTH_TOKEN]
  if (keySid && keySecret) return twilio(keySid, keySecret, { accountSid: sid })
  if (token) return twilio(sid, token)
  return null
}
export const twilioConfigured = () => client() !== null

/** Whether a status callback carries Twilio's signature for the URL we registered (a store's own account signs with its token). */
export function twilioSignatureValid(signature: string, messageId: string, params: Record<string, string>, authToken = process.env.TWILIO_AUTH_TOKEN): boolean {
  const token = authToken
  const url = statusCallbackUrl(messageId)
  return !!(token && url && signature && twilio.validateRequest(token, signature, url, params))
}

export function normalizePhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) return d
  if (d.length === 10) return '+91' + d
  if (d.length === 12 && d.startsWith('91')) return '+' + d
  return '+' + d
}

/** The status callback URL a send registers, which is also what Twilio signs. */
export function statusCallbackUrl(messageId: string) {
  const base = process.env.PUBLIC_BASE_URL
  // Twilio rejects the whole send for a non-public callback (http://…localhost in dev).
  if (!base || !/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) return undefined
  return `${base.replace(/\/$/, '')}/webhooks/twilio/status?m=${messageId}`
}

/** `ov`: the store's own sender + credentials; a messaging service SID picks the sender from its pool. */
export async function sendSms(o: { to: string; body: string; messageId: string }, ov?: SenderOverride): Promise<string> {
  const c = client(ov)
  const from = ov ? ov.sender : SMS_FROM
  const mss = ov?.config.messaging_service_sid
  if (!c || (!from && !mss)) throw new Error('Twilio SMS not configured')
  const m = await c.messages.create({ ...(mss ? { messagingServiceSid: mss } : {}), ...(from ? { from } : {}), to: normalizePhone(o.to), body: o.body, statusCallback: statusCallbackUrl(o.messageId) })
  return m.sid
}

export async function sendWhatsApp(o: {
  to: string
  body?: string
  contentSid?: string
  variables?: Record<string, string>
  messageId: string
}, ov?: SenderOverride): Promise<string> {
  const c = client(ov)
  const from = ov ? ov.sender : WA_FROM
  if (!c || !from) throw new Error('Twilio WhatsApp not configured')
  const base = { from: `whatsapp:${from}`, to: `whatsapp:${normalizePhone(o.to)}`, statusCallback: statusCallbackUrl(o.messageId) }
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

/** No public callback URL (local dev) → delivery outcomes have to be polled. */
export const callbacksEnabled = () => statusCallbackUrl('x') !== undefined

export async function fetchStatus(sid: string, ov?: SenderOverride): Promise<{ status: string; code?: string; message?: string }> {
  const c = client(ov)
  if (!c) throw new Error('Twilio not configured')
  const m = await c.messages(sid).fetch()
  return { status: m.status, code: m.errorCode ? String(m.errorCode) : undefined, message: m.errorMessage ?? undefined }
}
