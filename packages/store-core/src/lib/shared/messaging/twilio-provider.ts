import twilio from 'twilio'
import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'
import type { SmsProvider, WhatsAppProvider } from './types'
import type { TenantSender } from '@/lib/messaging/tenant-senders'

// All Twilio specifics live here: client construction (API key preferred, auth-token fallback),
// the sender numbers, the `whatsapp:` channel prefix, and the two `messages.create` payload shapes.
// A store with its own sender (tenant_messaging_senders) gets the same providers bound to its number
// and credentials through the *For factories; the bare exports are the platform env.

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const API_KEY_SID = process.env.TWILIO_API_KEY_SID
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET
const SMS_FROM = process.env.TWILIO_FROM_NUMBER || '+18722179910'
const WA_FROM = process.env.TWILIO_WHATSAPP_FROM || '+18722179910'
const MAX_INBOUND_MEDIA = 25 * 1024 * 1024

export type SenderOverride = Pick<TenantSender, 'sender' | 'config'>

function creds(ov?: SenderOverride) {
  const c = ov?.config
  return c
    ? { accountSid: c.account_sid, authToken: c.auth_token, apiKeySid: c.api_key_sid, apiKeySecret: c.api_key_secret }
    : { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, apiKeySid: API_KEY_SID, apiKeySecret: API_KEY_SECRET }
}

function getClient(ov?: SenderOverride) {
  const { accountSid, authToken, apiKeySid, apiKeySecret } = creds(ov)
  if (!accountSid) return null
  if (apiKeySid && apiKeySecret) {
    return twilio(apiKeySid, apiKeySecret, { accountSid })
  }
  if (authToken) return twilio(accountSid, authToken)
  return null
}

// Delivery/price callback URL carrying the current tenant id (the webhook has no Host). Null when the
// base URL or tenant is unknown, so no callback is requested (send still proceeds; just no true-up).
function statusCallback(): string | undefined {
  const base = process.env.PUBLIC_WEBHOOK_BASE_URL || process.env.APP_URL
  const tenantId = getCurrentTenantId()
  if (!base || !tenantId) return undefined
  return `${base.replace(/\/$/, '')}/api/webhooks/twilio/status?t=${encodeURIComponent(tenantId)}`
}

/** SMS from the platform number, or from the store's own sender (a messaging service SID picks from its pool). */
export function twilioSmsProviderFor(ov?: SenderOverride): SmsProvider {
  const from = ov ? ov.sender : SMS_FROM
  const mss = ov?.config.messaging_service_sid
  return {
    get configured() {
      return getClient(ov) !== null && !!(from || mss)
    },
    name: 'twilio',
    from,
    async sendText(toE164, body) {
      const client = getClient(ov)
      if (!client) throw new Error('Twilio SMS not configured')
      const cb = statusCallback()
      const msg = await client.messages.create({
        ...(mss ? { messagingServiceSid: mss } : {}),
        ...(from ? { from } : {}),
        to: toE164,
        body,
        ...(cb ? { statusCallback: cb } : {}),
      })
      return msg.sid
    },
  }
}

export function twilioWhatsAppProviderFor(ov?: SenderOverride): WhatsAppProvider {
  const from = ov ? ov.sender : WA_FROM
  return {
    get configured() {
      return getClient(ov) !== null && !!from
    },
    name: 'twilio',
    from,
    async sendTemplate(toE164, templateRef, vars) {
      const client = getClient(ov)
      if (!client) throw new Error('Twilio WhatsApp not configured')
      const cb = statusCallback()
      const msg = await client.messages.create({
        from: `whatsapp:${from}`,
        to: `whatsapp:${toE164}`,
        contentSid: templateRef,
        contentVariables: JSON.stringify(vars),
        ...(cb ? { statusCallback: cb } : {}),
      })
      return msg.sid
    },
    async sendText(toE164, body) {
      const client = getClient(ov)
      if (!client) throw new Error('Twilio WhatsApp not configured')
      const cb = statusCallback()
      const msg = await client.messages.create({
        from: `whatsapp:${from}`,
        to: `whatsapp:${toE164}`,
        body,
        ...(cb ? { statusCallback: cb } : {}),
      })
      return msg.sid
    },
    // Twilio fetches mediaUrl itself, so it must be a public (presigned) https URL.
    async sendMedia(toE164, media) {
      const client = getClient(ov)
      if (!client) throw new Error('Twilio WhatsApp not configured')
      if (!/^https:\/\//.test(media.url)) throw new Error('Twilio media needs a public https URL')
      const cb = statusCallback()
      const msg = await client.messages.create({
        from: `whatsapp:${from}`,
        to: `whatsapp:${toE164}`,
        mediaUrl: [media.url],
        ...(media.caption ? { body: media.caption } : {}),
        ...(cb ? { statusCallback: cb } : {}),
      })
      return msg.sid
    },
    // Twilio has no API to mark an inbound WhatsApp message read.
    async markRead() {},
    // Inbound MediaUrlN is on api.twilio.com and needs the account's basic auth.
    async downloadMedia(ref) {
      const u = new URL(ref)
      if (u.protocol !== 'https:' || !/(^|\.)twilio\.com$/.test(u.hostname)) throw new Error('not a Twilio media URL')
      const { accountSid, authToken, apiKeySid, apiKeySecret } = creds(ov)
      const user = apiKeySid && apiKeySecret ? apiKeySid : accountSid
      const pass = apiKeySid && apiKeySecret ? apiKeySecret : authToken
      if (!user || !pass) throw new Error('Twilio WhatsApp not configured')
      const res = await fetch(ref, {
        headers: { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`Twilio media fetch ${res.status}`)
      const len = Number(res.headers.get('content-length') || 0)
      if (len > MAX_INBOUND_MEDIA) throw new Error('media too large')
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > MAX_INBOUND_MEDIA) throw new Error('media too large')
      return { bytes, mime: (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() }
    },
  }
}

export const twilioSmsProvider: SmsProvider = twilioSmsProviderFor()
export const twilioWhatsAppProvider: WhatsAppProvider = twilioWhatsAppProviderFor()
