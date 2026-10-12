import twilio from 'twilio'
import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'
import type { SmsProvider, WhatsAppProvider } from './types'

// All Twilio specifics live here: client construction (API key preferred, auth-token fallback),
// the sender numbers, the `whatsapp:` channel prefix, and the two `messages.create` payload shapes.

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const API_KEY_SID = process.env.TWILIO_API_KEY_SID
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET
const SMS_FROM = process.env.TWILIO_FROM_NUMBER || '+18722179910'
const WA_FROM = process.env.TWILIO_WHATSAPP_FROM || '+18722179910'

function getClient() {
  if (!ACCOUNT_SID) return null
  if (API_KEY_SID && API_KEY_SECRET) {
    return twilio(API_KEY_SID, API_KEY_SECRET, { accountSid: ACCOUNT_SID })
  }
  if (AUTH_TOKEN) return twilio(ACCOUNT_SID, AUTH_TOKEN)
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

export const twilioSmsProvider: SmsProvider = {
  get configured() {
    return getClient() !== null
  },
  from: SMS_FROM,
  async sendText(toE164, body) {
    const client = getClient()
    if (!client) throw new Error('Twilio SMS not configured')
    const cb = statusCallback()
    const msg = await client.messages.create({
      from: SMS_FROM,
      to: toE164,
      body,
      ...(cb ? { statusCallback: cb } : {}),
    })
    return msg.sid
  },
}

export const twilioWhatsAppProvider: WhatsAppProvider = {
  get configured() {
    return getClient() !== null
  },
  from: WA_FROM,
  async sendTemplate(toE164, templateRef, vars) {
    const client = getClient()
    if (!client) throw new Error('Twilio WhatsApp not configured')
    const cb = statusCallback()
    const msg = await client.messages.create({
      from: `whatsapp:${WA_FROM}`,
      to: `whatsapp:${toE164}`,
      contentSid: templateRef,
      contentVariables: JSON.stringify(vars),
      ...(cb ? { statusCallback: cb } : {}),
    })
    return msg.sid
  },
  async sendText(toE164, body) {
    const client = getClient()
    if (!client) throw new Error('Twilio WhatsApp not configured')
    const cb = statusCallback()
    const msg = await client.messages.create({
      from: `whatsapp:${WA_FROM}`,
      to: `whatsapp:${toE164}`,
      body,
      ...(cb ? { statusCallback: cb } : {}),
    })
    return msg.sid
  },
}
