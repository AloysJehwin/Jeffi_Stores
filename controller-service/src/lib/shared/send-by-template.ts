// Thin client to messaging-service `POST /messages {template, variables, to, channel}`.
// Collapses the ~40 `send*Email|SMS|WhatsApp` wrappers that each used to inline their body.
// Wrappers keep their public shape so callers don't change; they now one-line into here.

import { messagingTenant, serviceToken } from '@/lib/messaging/library'
import { currentReplyScope, recordScopedSend } from '@/lib/replies/scope'

const MESSAGING_URL = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')

type Channel = 'email' | 'sms' | 'whatsapp'

export interface SendByTemplateInput {
  channel: Channel
  slug: string
  to: string
  variables?: Record<string, unknown>
  subject?: string
  reference?: string
  locale?: string
}

export interface SendResult {
  id?: string
  status: string
  error?: string
  /** The provider's own message id (Twilio SID / WhatsApp message id). */
  providerSid?: string | null
  body?: string
}

export async function brandFields(channel: Channel): Promise<{ brand?: string; kicker?: string; footer_contact?: string; accent?: string }> {
  if (channel !== 'email') return {}
  try {
    const { currentBrandNameAsync, storeContactLine, storeMailTheme } = await import('@/lib/catalog/brand')
    const [brand, footer_contact, theme] = await Promise.all([currentBrandNameAsync(), storeContactLine(), storeMailTheme()])
    return {
      brand,
      kicker: 'Notifications',
      footer_contact: footer_contact || undefined,
      accent: /^#[0-9a-f]{6}$/i.test(theme.accent) ? theme.accent : undefined,
    }
  } catch { return {} }
}

// Site Controls' SMS / WhatsApp switches; messaging-service enforces them too.
async function channelOn(channel: Channel): Promise<boolean> {
  if (channel === 'email') return true
  try {
    const { getFeatureFlags } = await import('@/lib/catalog/site-controls')
    const flags = await getFeatureFlags()
    return channel === 'sms' ? flags.smsEnabled : flags.whatsappEnabled
  } catch {
    return process.env[channel === 'sms' ? 'SMS_DISABLED' : 'WHATSAPP_DISABLED'] !== 'true'
  }
}

export async function sendByTemplate(i: SendByTemplateInput): Promise<SendResult> {
  if (!(await channelOn(i.channel))) return { status: 'skipped', error: 'channel_disabled' }
  const tenant = await messagingTenant()
  const extra = await brandFields(i.channel)
  const body = {
    channel: i.channel,
    to: i.to,
    template: i.slug,
    variables: i.variables ?? {},
    subject: i.subject,
    reference: i.reference,
    locale: i.locale,
    // Inside a reply scope the customer's email reply comes back to the record that asked.
    reply_to: i.channel === 'email' ? currentReplyScope()?.replyTo : undefined,
    ...extra,
  }
  try {
    const res = await fetch(`${MESSAGING_URL}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${serviceToken(tenant.tenantId, tenant.slug)}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { status: 'failed', error: data?.message || data?.error || `HTTP ${res.status}` }
    if (data.provider_ref && data.status !== 'failed') {
      if (i.channel === 'email') {
        const ref = String(data.provider_ref)
        await recordScopedSend({ channel: 'email', emailMessageIds: [ref.includes('@') ? ref : `${ref}@email.amazonses.com`] })
      } else await recordScopedSend({ channel: i.channel, providerSid: data.provider_ref })
    }
    return { id: data.id, status: data.status ?? 'sent', providerSid: data.provider_ref ?? null, body: data.body }
  } catch (e: any) {
    return { status: 'failed', error: e?.message || 'network error' }
  }
}
