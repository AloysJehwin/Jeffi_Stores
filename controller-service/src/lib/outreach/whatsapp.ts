import { sendByTemplate } from '@/lib/shared/send-by-template'
import { sendWhatsAppDirect } from '@/lib/shared/whatsapp'
import { outreachPool } from './db'
import { recordEvent } from './events'
import { getContact } from './contacts'
import { isSuppressed } from './suppress'
import type { OutreachContact } from './types'

// WhatsApp to outreach contacts, from the flagship's customer number (sent as the platform). Templates go through
// messaging-service (outreach/* in its seed catalog, `_hi` for Hindi); free text only inside the 24h window that
// an inbound message opens. Nothing goes out without recorded WhatsApp consent. Every send, refusal and inbound is
// kept in outreach_messages + outreach_events. In test mode the message is captured there instead of sent.

export const WA_WINDOW_HOURS = 24

export const OUTREACH_TEMPLATES = ['preview_ready', 'details_needed', 'site_live', 'claim', 'callback', 'trial_ending'] as const
export type OutreachTemplate = (typeof OUTREACH_TEMPLATES)[number]

/** Program test mode: OUTREACH_TEST_MODE on/off wins; unset, everything outside production is captured. */
export function captureMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.OUTREACH_TEST_MODE ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return env.NODE_ENV !== 'production'
}

/** Only English and Hindi templates exist; every other language gets the English copy. */
export const templateLanguage = (language: string | null | undefined): 'en' | 'hi' => (language === 'hi' ? 'hi' : 'en')
export const templateSlug = (t: OutreachTemplate, language: string | null | undefined) =>
  `outreach/${t}${templateLanguage(language) === 'hi' ? '_hi' : ''}`

const MISSING_LABELS: Record<string, { en: string; hi: string }> = {
  whatTheyDo: { en: 'what your business does', hi: 'आपका काम क्या है' },
  audience: { en: 'who your customers are', hi: 'आपके ग्राहक कौन हैं' },
  highlights: { en: 'what makes you special', hi: 'आपकी खासियत' },
  contact: { en: 'a phone number or email for customers', hi: 'ग्राहकों के लिए फ़ोन नंबर या ईमेल' },
  hours: { en: 'your opening hours', hi: 'खुलने का समय' },
  address: { en: 'your address', hi: 'आपका पता' },
  style: { en: 'the look you would like', hi: 'वेबसाइट का पसंदीदा रूप' },
  language: { en: "the website's language", hi: 'वेबसाइट की भाषा' },
}

/** Brief keys (or plain phrases) as one readable list: "a, b and c". */
export function missingText(missing: string[], lang: 'en' | 'hi'): string {
  const parts = [...new Set(missing.map(m => MISSING_LABELS[m]?.[lang] ?? m.trim()).filter(Boolean))]
  if (parts.length <= 1) return parts[0] ?? (lang === 'hi' ? 'कुछ और जानकारी' : 'a few more details')
  return `${parts.slice(0, -1).join(', ')} ${lang === 'hi' ? 'और' : 'and'} ${parts[parts.length - 1]}`
}

const when = (v: Date | string, lang: 'en' | 'hi', opts: Intl.DateTimeFormatOptions) =>
  typeof v === 'string' ? v : v.toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', ...opts })

export interface TemplateSendInput {
  template: OutreachTemplate
  /** Where the button goes: the preview, live site or claim link. */
  url: string
  /** details_needed: brief keys (whatTheyDo, hours…) or plain phrases. */
  missing?: string[]
  /** callback: when we will call. */
  callbackAt?: Date | string
  /** trial_ending: the day the trial ends. */
  trialEndsAt?: Date | string
  actor?: string
  callId?: string | null
}

/** Template variables in the catalog's order: {{1}} owner, {{2}} business, {{3}} the template's own detail. */
export function templateVariables(contact: Pick<OutreachContact, 'owner_name' | 'business_name' | 'language'>, input: TemplateSendInput): Record<string, string> {
  const lang = templateLanguage(contact.language)
  const vars: Record<string, string> = {
    '1': contact.owner_name?.trim() || (lang === 'hi' ? 'जी' : 'there'),
    '2': contact.business_name.trim(),
  }
  if (input.template === 'details_needed') vars['3'] = missingText(input.missing ?? [], lang)
  if (input.template === 'callback') vars['3'] = when(input.callbackAt ?? '', lang, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  if (input.template === 'trial_ending') vars['3'] = when(input.trialEndsAt ?? '', lang, { day: 'numeric', month: 'long' })
  return vars
}

export type RefusalReason = 'not_found' | 'no_consent' | 'opted_out' | 'suppressed' | 'window_closed' | 'invalid_input'
export type SendOutcome =
  | { ok: true; mode: 'sent' | 'captured'; messageId: string; providerMessageId: string | null }
  | { ok: false; reason: RefusalReason | 'failed'; error?: string; messageId?: string }

export const windowOpen = (c: Pick<OutreachContact, 'wa_window_expires_at'>, now: Date = new Date()) =>
  !!c.wa_window_expires_at && new Date(c.wa_window_expires_at).getTime() > now.getTime()

interface Gate {
  text?: boolean
  /** The one reply to a STOP: no consent or opt-out check, still only inside the window. */
  optOutConfirmation?: boolean
}

async function refusal(contact: OutreachContact, g: Gate, now: Date): Promise<RefusalReason | null> {
  if (!g.optOutConfirmation) {
    if (contact.opted_out_at || contact.status === 'opted_out') return 'opted_out'
    if (contact.status === 'suppressed' || (await isSuppressed(contact.phone))) return 'suppressed'
    if (!contact.consent_whatsapp_at) return 'no_consent'
  }
  if (g.text && !windowOpen(contact, now)) return 'window_closed'
  return null
}

async function refuse(contact: OutreachContact | null, contactId: string, reason: RefusalReason, data: Record<string, unknown>, actor: string): Promise<SendOutcome> {
  await recordEvent(contact?.id ?? null, 'whatsapp_refused', { actor, data: { ...data, reason, contact_id: contactId } })
  return { ok: false, reason }
}

async function saveOut(contactId: string, slug: string | null, body: string, providerId: string | null, status: string): Promise<string> {
  const r = await outreachPool().query(
    `INSERT INTO outreach_messages (contact_id, direction, template_slug, body, provider_message_id, status) VALUES ($1,'out',$2,$3,$4,$5) RETURNING id`,
    [contactId, slug, body, providerId, status]
  )
  return r.rows[0].id
}

const URL_RE = /^https?:\/\/\S+$/i

/** One approved outreach template, in the contact's language, with its URL button. */
export async function sendOutreachTemplate(contactId: string, input: TemplateSendInput, now: Date = new Date()): Promise<SendOutcome> {
  const actor = input.actor ?? 'system'
  const contact = await getContact(contactId)
  if (!contact) return refuse(null, contactId, 'not_found', { template: input.template }, actor)
  if (!OUTREACH_TEMPLATES.includes(input.template) || !URL_RE.test(input.url ?? ''))
    return refuse(contact, contactId, 'invalid_input', { template: input.template }, actor)
  const reason = await refusal(contact, {}, now)
  if (reason) return refuse(contact, contactId, reason, { template: input.template }, actor)

  const slug = templateSlug(input.template, contact.language)
  const variables = templateVariables(contact, input)
  const base = { template: input.template, slug, to: contact.phone, language: templateLanguage(contact.language), variables, button_url: input.url }

  if (captureMode()) {
    const body = `[${slug}] ${Object.entries(variables).map(([k, v]) => `{{${k}}}=${v}`).join(' · ')} → ${input.url}`
    const messageId = await saveOut(contact.id, slug, body, null, 'captured')
    await recordEvent(contact.id, 'whatsapp_out', { actor, callId: input.callId, data: { ...base, body, message_id: messageId, mode: 'captured' } })
    return { ok: true, mode: 'captured', messageId, providerMessageId: null }
  }

  const res = await sendByTemplate({
    channel: 'whatsapp', slug, to: contact.phone, variables, buttonUrl: input.url,
    asPlatform: true, audience: 'customer', reference: `outreach:${contact.id}`,
  })
  const ok = res.status !== 'failed' && res.status !== 'skipped'
  const body = res.body || `[${slug}]`
  const messageId = await saveOut(contact.id, slug, body, res.providerSid ?? null, ok ? res.status || 'sent' : 'failed')
  await recordEvent(contact.id, 'whatsapp_out', {
    actor, callId: input.callId,
    data: { ...base, body, message_id: messageId, mode: 'sent', status: ok ? res.status : 'failed', error: ok ? null : res.error ?? res.status },
  })
  return ok ? { ok: true, mode: 'sent', messageId, providerMessageId: res.providerSid ?? null } : { ok: false, reason: 'failed', error: res.error ?? res.status, messageId }
}

/** Free text, only inside the 24h window (replies to the owner's messages). */
export async function sendOutreachText(
  contactId: string,
  text: string,
  opts: { actor?: string; optOutConfirmation?: boolean } = {},
  now: Date = new Date()
): Promise<SendOutcome> {
  const actor = opts.actor ?? 'system'
  const contact = await getContact(contactId)
  if (!contact) return refuse(null, contactId, 'not_found', { kind: 'text' }, actor)
  const body = text.trim().slice(0, 4000)
  if (!body) return refuse(contact, contactId, 'invalid_input', { kind: 'text' }, actor)
  const reason = await refusal(contact, { text: true, optOutConfirmation: opts.optOutConfirmation }, now)
  if (reason) return refuse(contact, contactId, reason, { kind: 'text' }, actor)

  const base = { kind: 'text', to: contact.phone, body, opt_out_confirmation: !!opts.optOutConfirmation }
  if (captureMode()) {
    const messageId = await saveOut(contact.id, null, body, null, 'captured')
    await recordEvent(contact.id, 'whatsapp_out', { actor, data: { ...base, message_id: messageId, mode: 'captured' } })
    return { ok: true, mode: 'captured', messageId, providerMessageId: null }
  }
  const sid = await sendWhatsAppDirect({ phone: contact.phone, text: body, kind: 'outreach', audience: 'customer' })
  const messageId = await saveOut(contact.id, null, body, sid, sid ? 'sent' : 'failed')
  await recordEvent(contact.id, 'whatsapp_out', { actor, data: { ...base, message_id: messageId, mode: 'sent', status: sid ? 'sent' : 'failed' } })
  return sid ? { ok: true, mode: 'sent', messageId, providerMessageId: sid } : { ok: false, reason: 'failed', error: 'send failed', messageId }
}

export interface InboundRecord {
  text: string
  providerMessageId: string | null
  receivedAt?: Date
  hasMedia?: boolean
}

/** Stores an inbound message and opens the 24h window from it. Null when this provider message was already stored. */
export async function recordInbound(contact: Pick<OutreachContact, 'id' | 'phone'>, m: InboundRecord): Promise<{ messageId: string; windowExpiresAt: Date } | null> {
  const pool = outreachPool()
  if (m.providerMessageId) {
    const dup = await pool.query(`SELECT id FROM outreach_messages WHERE contact_id = $1 AND direction = 'in' AND provider_message_id = $2 LIMIT 1`, [contact.id, m.providerMessageId])
    if (dup.rows.length) return null
  }
  const at = m.receivedAt ?? new Date()
  const windowExpiresAt = new Date(at.getTime() + WA_WINDOW_HOURS * 3600_000)
  const body = [m.text.trim(), m.hasMedia ? '[attachment]' : ''].filter(Boolean).join('\n')
  const r = await pool.query(
    `INSERT INTO outreach_messages (contact_id, direction, body, provider_message_id, status) VALUES ($1,'in',$2,$3,'received') RETURNING id`,
    [contact.id, body, m.providerMessageId]
  )
  // Never moves the window back (a late, out-of-order delivery).
  await pool.query(
    `UPDATE outreach_contacts SET wa_window_expires_at = GREATEST(COALESCE(wa_window_expires_at, $2), $2), updated_at = now() WHERE id = $1`,
    [contact.id, windowExpiresAt]
  )
  await recordEvent(contact.id, 'whatsapp_in', { actor: `whatsapp:${contact.phone}`, data: { message_id: r.rows[0].id, provider_message_id: m.providerMessageId, has_media: !!m.hasMedia } })
  return { messageId: r.rows[0].id, windowExpiresAt }
}

export interface CapturedWhatsApp {
  eventId: number
  messageId: string
  contactId: string
  to: string
  kind: 'template' | 'text'
  template: OutreachTemplate | null
  slug: string | null
  language: string | null
  variables: Record<string, string>
  buttonUrl: string | null
  body: string
  at: string
}

/** What test mode captured instead of sending, oldest first (the E2E harness reads this). */
export async function readCapturedWhatsApp(opts: { contactId?: string; phone?: string; since?: Date } = {}): Promise<CapturedWhatsApp[]> {
  const where = [`kind = 'whatsapp_out'`, `data->>'mode' = 'captured'`]
  const params: unknown[] = []
  const add = (sql: string, v: unknown) => {
    params.push(v)
    where.push(sql.replace('?', `$${params.length}`))
  }
  if (opts.contactId) add('contact_id = ?', opts.contactId)
  if (opts.phone) add(`data->>'to' = ?`, opts.phone)
  if (opts.since) add('created_at >= ?', opts.since)
  const r = await outreachPool().query(`SELECT id, contact_id, data, created_at FROM outreach_events WHERE ${where.join(' AND ')} ORDER BY id`, params)
  return r.rows.map((row: { id: number | string; contact_id: string; data: Record<string, any>; created_at: string | Date }) => {
    const d = row.data ?? {}
    return {
      eventId: Number(row.id),
      messageId: d.message_id,
      contactId: row.contact_id,
      to: d.to,
      kind: d.kind === 'text' ? 'text' : 'template',
      template: d.template ?? null,
      slug: d.slug ?? null,
      language: d.language ?? null,
      variables: d.variables ?? {},
      buttonUrl: d.button_url ?? null,
      body: d.body ?? '',
      at: new Date(row.created_at).toISOString(),
    }
  })
}
