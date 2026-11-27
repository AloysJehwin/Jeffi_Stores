import { sendByTemplate } from '@/lib/shared/send-by-template'
import { sendWhatsAppDirect } from '@/lib/shared/whatsapp'
import { outreachPool } from '../../db'
import { recordEvent } from '../../events'
import type { OutreachContact } from '../../types'
import { captureMode, windowOpen } from '../../whatsapp'
import type { AgentPurpose, JobRow } from '../types'
import { shopperConsent } from './consent'
import { withFlagshipStore } from './context'

// Sends to a flagship shopper: the store's own templates and numbers through sendByTemplate (Site Controls switches and
// the wallet apply), recorded in outreach_messages / outreach_events like the Showcase sends. Test mode captures
// instead of sending, exactly as lib/outreach/whatsapp.ts does.

export const isShopper = (c: Pick<OutreachContact, 'program'> & { kind?: string }): boolean => c.kind === 'shopper' || c.program === 'store'

/** The purpose of the skill version the job is pinned to (promotional adds the marketing opt-out and DND gates). */
export async function jobPurpose(job: JobRow | null): Promise<AgentPurpose> {
  if (!job) return 'transactional'
  const r = await outreachPool().query(
    `SELECT COALESCE(v.meta->>'purpose', s.purpose) AS purpose
       FROM outreach_skills s LEFT JOIN outreach_skill_versions v ON v.id = $2
      WHERE s.id = $1`,
    [job.skill_id, job.skill_version_id]
  )
  return r.rows[0]?.purpose === 'promotional' ? 'promotional' : 'transactional'
}

export type SendRefusal = 'no_consent' | 'marketing_opt_out' | 'dnd' | 'window_closed'

/**
 * Gates a shopper send on top of the contact gate (opt-out, suppression) and the quotas: WhatsApp needs the shopper's
 * opt-in (order updates on WhatsApp) or consent recorded on the contact; a promotional job needs no marketing opt-out
 * (and, for SMS, a DND-clear number). marketing: true holds a marketing-category template to the same rule on any job.
 */
export async function sendGate(contact: OutreachContact, job: JobRow | null, channel: 'whatsapp' | 'sms', opts: { text?: boolean; marketing?: boolean; now?: Date } = {}): Promise<SendRefusal | null> {
  const [purpose, consent] = await Promise.all([jobPurpose(job), shopperConsent(contact.phone)])
  if (purpose === 'promotional' || opts.marketing) {
    if (consent.marketingOptOut) return 'marketing_opt_out'
    if (channel === 'sms' && contact.dnd_status === 'dnd') return 'dnd'
  }
  if (channel === 'whatsapp') {
    if (!contact.consent_whatsapp_at && !consent.whatsappOptIn) return 'no_consent'
    if (opts.text && !windowOpen(contact, opts.now ?? new Date())) return 'window_closed'
  }
  return null
}

export type StoreSendOutcome = { ok: true; mode: 'sent' | 'captured'; messageId: string } | { ok: false; reason: string; error?: string; messageId?: string }

interface Meta {
  actor: string
  callId?: string | null
}

async function saveOut(contactId: string, slug: string | null, body: string, providerId: string | null, status: string): Promise<string> {
  const r = await outreachPool().query(
    `INSERT INTO outreach_messages (contact_id, direction, template_slug, body, provider_message_id, status) VALUES ($1,'out',$2,$3,$4,$5) RETURNING id`,
    [contactId, slug, body, providerId, status]
  )
  return r.rows[0].id
}

const E164 = /^\+\d{10,15}$/

export interface StoreTemplateInput {
  /** Store catalog slug: feedback/request, cart/abandoned, order/shipped ... */
  slug: string
  variables: Record<string, string>
  /** The template's URL button, when it has one. */
  buttonUrl?: string
  /** A link that is a bearer credential (a review token): recorded as this label in production, never stored readable. */
  secretUrl?: { url: string; label: string }
}

/** One approved store WhatsApp template to the shopper's number. */
export async function sendStoreTemplate(contact: OutreachContact, input: StoreTemplateInput, meta: Meta): Promise<StoreSendOutcome> {
  if (!E164.test(contact.phone)) return { ok: false, reason: 'invalid_phone' }
  // A bearer link stays readable only in captured test messages outside production (the E2E harness needs it).
  const hide = !!input.secretUrl && !(captureMode() && process.env.NODE_ENV !== 'production')
  const keep = (s: string) => (hide && input.secretUrl ? s.split(input.secretUrl.url).join(input.secretUrl.label) : s)
  const shown = input.buttonUrl ? keep(input.buttonUrl) : null
  const base = { template: input.slug, slug: input.slug, to: contact.phone, language: 'en', variables: Object.fromEntries(Object.entries(input.variables).map(([k, v]) => [k, keep(v)])), button_url: shown }

  if (captureMode()) {
    const head = `[${input.slug}] ${Object.entries(input.variables).map(([k, v]) => `{{${k}}}=${keep(v)}`).join(' · ')}`
    const body = shown ? `${head} → ${shown}` : head
    const messageId = await saveOut(contact.id, input.slug, body, null, 'captured')
    await recordEvent(contact.id, 'whatsapp_out', { actor: meta.actor, callId: meta.callId, data: { ...base, body, message_id: messageId, mode: 'captured', audience: 'shopper' } })
    return { ok: true, mode: 'captured', messageId }
  }

  const res = await withFlagshipStore(() =>
    sendByTemplate({ channel: 'whatsapp', slug: input.slug, to: contact.phone, variables: input.variables, buttonUrl: input.buttonUrl, audience: 'customer', reference: `outreach:${contact.id}` })
  )
  const ok = res.status !== 'failed' && res.status !== 'skipped'
  const full = res.body || `[${input.slug}]`
  const body = keep(full)
  const messageId = await saveOut(contact.id, input.slug, body, res.providerSid ?? null, ok ? res.status || 'sent' : 'failed')
  await recordEvent(contact.id, 'whatsapp_out', {
    actor: meta.actor, callId: meta.callId,
    data: { ...base, body, message_id: messageId, mode: 'sent', status: ok ? res.status : 'failed', error: ok ? null : res.error ?? res.status, audience: 'shopper' },
  })
  return ok ? { ok: true, mode: 'sent', messageId } : { ok: false, reason: res.status === 'skipped' ? 'channel_off' : 'failed', error: res.error ?? res.status, messageId }
}

/** Free text inside the 24 h window the shopper's last message opened. The caller has run sendGate with text: true. */
export async function sendStoreText(contact: OutreachContact, text: string, meta: Meta): Promise<StoreSendOutcome> {
  const body = text.trim().slice(0, 4000)
  if (!body) return { ok: false, reason: 'invalid_input' }
  const base = { kind: 'text', to: contact.phone, body, audience: 'shopper' }
  if (captureMode()) {
    const messageId = await saveOut(contact.id, null, body, null, 'captured')
    await recordEvent(contact.id, 'whatsapp_out', { actor: meta.actor, callId: meta.callId, data: { ...base, message_id: messageId, mode: 'captured' } })
    return { ok: true, mode: 'captured', messageId }
  }
  const sid = await withFlagshipStore(() => sendWhatsAppDirect({ phone: contact.phone, text: body, kind: 'outreach', audience: 'customer' }))
  const messageId = await saveOut(contact.id, null, body, sid, sid ? 'sent' : 'failed')
  await recordEvent(contact.id, 'whatsapp_out', { actor: meta.actor, callId: meta.callId, data: { ...base, message_id: messageId, mode: 'sent', status: sid ? 'sent' : 'failed' } })
  return sid ? { ok: true, mode: 'sent', messageId } : { ok: false, reason: 'failed', messageId }
}

/** A DLT-registered store SMS template. Transactional ones need no consent beyond the contact gate. */
export async function sendStoreSms(contact: OutreachContact, input: { slug: string; variables: Record<string, string> }, meta: Meta): Promise<StoreSendOutcome> {
  if (!E164.test(contact.phone)) return { ok: false, reason: 'invalid_phone' }
  const logSlug = `sms:${input.slug}`
  const base = { channel: 'sms', template: input.slug, to: contact.phone, variables: input.variables, audience: 'shopper' }
  if (captureMode()) {
    const body = `[sms ${input.slug}] ${Object.entries(input.variables).map(([k, v]) => `${k}=${v}`).join(' · ')}`
    const messageId = await saveOut(contact.id, logSlug, body, null, 'captured')
    await recordEvent(contact.id, 'sms_out', { actor: meta.actor, callId: meta.callId, data: { ...base, body, message_id: messageId, mode: 'captured' } })
    return { ok: true, mode: 'captured', messageId }
  }
  const res = await withFlagshipStore(() => sendByTemplate({ channel: 'sms', slug: input.slug, to: contact.phone, variables: input.variables, reference: `outreach:${contact.id}` }))
  const ok = res.status !== 'failed' && res.status !== 'skipped'
  const body = res.body || `[sms ${input.slug}]`
  const messageId = await saveOut(contact.id, logSlug, body, res.providerSid ?? null, ok ? res.status || 'sent' : 'failed')
  await recordEvent(contact.id, 'sms_out', { actor: meta.actor, callId: meta.callId, data: { ...base, body, message_id: messageId, mode: 'sent', status: ok ? res.status : 'failed', error: ok ? null : res.error ?? res.status } })
  return ok ? { ok: true, mode: 'sent', messageId } : { ok: false, reason: res.status === 'skipped' ? 'channel_off' : 'failed', error: res.error ?? res.status, messageId }
}

/** The payment link text goes out from Razorpay itself (notify); this records it for the contact like any other send. */
export async function recordPaymentLinkSent(contact: OutreachContact, o: { orderNumber: string; mode: 'sent' | 'captured'; expiresAt?: string }, meta: Meta): Promise<string> {
  const body = `[payment link for order #${o.orderNumber}${o.mode === 'captured' ? ' (captured, not created)' : ' sent by SMS from Razorpay'}]`
  const messageId = await saveOut(contact.id, 'razorpay/payment-link', body, null, o.mode)
  await recordEvent(contact.id, 'sms_out', { actor: meta.actor, callId: meta.callId, data: { channel: 'sms', template: 'razorpay/payment-link', to: contact.phone, body, message_id: messageId, mode: o.mode, expires_at: o.expiresAt ?? null, audience: 'shopper' } })
  return messageId
}
