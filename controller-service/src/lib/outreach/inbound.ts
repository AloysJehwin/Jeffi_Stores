import { markWhatsAppRead } from '@/lib/shared/whatsapp'
import { detectLang } from '@/lib/support/translate'
import { outreachPool } from './db'
import { recordEvent } from './events'
import { findActiveByPhone } from './contacts'
import { InvalidTransitionError, transition } from './state'
import { captureMode, recordInbound, sendOutreachText } from './whatsapp'
import { runAgentTurn } from './agent/runtime'
import { OPT_OUT_CONFIRMATION } from './agent/wa-lines'
import type { OutreachBrief } from './build'
import { LANGUAGES, type OutreachContact, type OutreachLanguage } from './types'

export { OPT_OUT_CONFIRMATION }

// WhatsApp from an owner the outreach program is talking to (interested…claimed, last 30 days). The webhook sends
// it here before the shopper bot and never forwards it on. STOP in any supported language opts out at once (one
// confirmation); anything else is an agent turn (agent/runtime.ts runAgentTurn) running the contact's skill, which
// replies in the owner's language inside the 24h window.

const ACTOR = 'outreach:whatsapp'

const clean = (s: string) =>
  s.normalize('NFC').replace(/[​-‍﻿]/g, '').replace(/[’‘`]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim()

// The whole message is one of these (Twilio's keywords and their equivalents).
const STOP_WORDS = [
  'stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt out', 'opt-out',
  'बंद', 'बंद करो', 'बंद करें', 'band', 'band karo', 'stop karo', 'रुको',
  'நிறுத்து', 'நிறுத்தவும்', 'ఆపు', 'ఆపండి', 'ನಿಲ್ಲಿಸಿ', 'ನಿಲ್ಲಿಸು', 'നിർത്തുക', 'നിർത്തൂ',
  'थांबवा', 'थांबा', 'बंद करा', 'বন্ধ', 'বন্ধ করুন', 'বন্ধ করো', 'બંધ', 'બંધ કરો',
].map(clean)

// Anywhere in the message: asking us to stop messaging them.
const STOP_PHRASES = [
  'unsubscribe', "don't message", 'dont message', 'do not message', "don't text", 'do not text', 'stop messaging', 'stop sending',
  'stop texting', 'no more messages', "don't contact", 'dont contact', 'do not contact', 'remove my number', 'remove me from',
  'opt me out', "don't whatsapp", 'do not whatsapp', 'stop whatsapp',
  'मैसेज मत', 'मेसेज मत', 'संदेश मत', 'मैसेज न भेज', 'मैसेज बंद', 'मेसेज बंद', 'संदेश न भेज', 'संदेश बंद', 'परेशान मत',
  'message mat', 'msg mat', 'messages mat', 'message band karo', 'msg band karo', 'message na bhej', 'pareshan mat',
  'செய்தி அனுப்ப வேண்டாம்', 'மெசேஜ் அனுப்ப வேண்டாம்', 'மெசேஜ் வேண்டாம்', 'தொந்தரவு செய்ய வேண்டாம்',
  'మెసేజ్ చేయొద్దు', 'మెసేజ్ పంపవద్దు', 'సందేశాలు పంపవద్దు', 'మెసేజ్‌లు పంపవద్దు', 'ఇబ్బంది పెట్టవద్దు',
  'ಮೆಸೇಜ್ ಮಾಡಬೇಡಿ', 'ಮೆಸೇಜ್ ಕಳುಹಿಸಬೇಡಿ', 'ಸಂದೇಶ ಕಳುಹಿಸಬೇಡಿ', 'ತೊಂದರೆ ಕೊಡಬೇಡಿ',
  'മെസ്സേജ് അയക്കരുത്', 'മെസേജ് അയക്കരുത്', 'സന്ദേശം അയക്കരുത്', 'ശല്യപ്പെടുത്തരുത്',
  'मेसेज करू नका', 'मेसेज पाठवू नका', 'संदेश पाठवू नका', 'त्रास देऊ नका',
  'মেসেজ করবেন না', 'মেসেজ পাঠাবেন না', 'বার্তা পাঠাবেন না', 'বিরক্ত করবেন না',
  'મેસેજ ન કરો', 'મેસેજ ના કરો', 'સંદેશ ન મોકલો', 'મેસેજ ન મોકલો', 'હેરાન ન કરો',
].map(clean)

/** STOP / "don't message" / "unsubscribe" in any supported language. */
export function isOptOut(text: string): boolean {
  const t = clean(text)
  if (!t) return false
  const bare = t.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '')
  return STOP_WORDS.includes(bare) || STOP_PHRASES.some(p => t.includes(p))
}

const isLang = (v: unknown): v is OutreachLanguage => typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v)

/** The language to answer in: the one this message is written in when we can tell, else the contact's. */
export function replyLanguage(contact: Pick<OutreachContact, 'language'>, text: string): OutreachLanguage {
  const own = isLang(contact.language) ? contact.language : 'en'
  const seen = detectLang(text, own)
  return isLang(seen) ? seen : own
}

export interface OutreachInbound {
  from: string
  text: string
  providerMessageId: string | null
  hasMedia?: boolean
  receivedAt?: Date
}

export type InboundResult =
  | { action: 'duplicate' }
  | { action: 'opted_out'; confirmed: boolean }
  | { action: 'replied' | 'no_reply' | 'fallback' | 'paused' | 'budget'; reply?: string; tools: string[] }

/**
 * The webhook's hook. True when the sender is an active outreach contact: the message is handled here (even when
 * that fails) and must not reach the shopper bot. False sends it on to the usual routing.
 */
export async function routeOutreachWhatsApp(m: OutreachInbound): Promise<boolean> {
  let contact: OutreachContact | null
  try {
    contact = await findActiveByPhone(m.from)
  } catch (e) {
    console.error('[outreach] contact lookup failed', e instanceof Error ? e.message : e)
    return false
  }
  if (!contact) return false
  try {
    await handleOutreachInbound(contact, m)
  } catch (e) {
    console.error('[outreach] inbound failed', e instanceof Error ? e.message : e)
    await recordEvent(contact.id, 'whatsapp_inbound_failed', { actor: ACTOR, data: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {})
  }
  return true
}

export async function handleOutreachInbound(contact: OutreachContact, m: OutreachInbound): Promise<InboundResult> {
  const stored = await recordInbound(contact, { text: m.text, providerMessageId: m.providerMessageId, receivedAt: m.receivedAt, hasMedia: m.hasMedia })
  if (!stored) return { action: 'duplicate' }
  if (m.providerMessageId && !captureMode()) void markWhatsAppRead(m.providerMessageId, 'customer')
  const lang = replyLanguage(contact, m.text)
  if (isOptOut(m.text)) return { action: 'opted_out', confirmed: await optOut(contact, lang, { via: 'keyword', text: m.text }) }
  const r = await runAgentTurn({ contact, channel: 'whatsapp', trigger: { kind: 'inbound', messageId: stored.messageId }, language: lang })
  if (r.action === 'opted_out') return { action: 'opted_out', confirmed: r.confirmed ?? false }
  return { action: r.action, ...(r.reply ? { reply: r.reply } : {}), tools: r.tools }
}

/** Status opted_out, the number on the suppression list, and one confirmation. False when it was already done. */
export async function optOut(contact: Pick<OutreachContact, 'id' | 'phone'>, lang: OutreachLanguage, why: { via: 'keyword' | 'assistant'; text?: string }): Promise<boolean> {
  try {
    await transition(contact, 'opted_out', { actor: ACTOR, data: { channel: 'whatsapp', via: why.via, text: why.text?.slice(0, 200) }, set: { opted_out_at: new Date() } })
  } catch (e) {
    if (e instanceof InvalidTransitionError) return false
    throw e
  }
  await outreachPool().query(
    `INSERT INTO outreach_suppressions (phone, reason, source) VALUES ($1, 'whatsapp_stop', 'whatsapp') ON CONFLICT (phone) DO NOTHING`,
    [contact.phone]
  )
  await recordEvent(contact.id, 'suppression_added', { actor: ACTOR, data: { phone: contact.phone, reason: 'whatsapp_stop', source: 'whatsapp' } })
  const sent = await sendOutreachText(contact.id, OPT_OUT_CONFIRMATION[lang], { actor: ACTOR, optOutConfirmation: true })
  return sent.ok
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 1000) : undefined)

/** The tool's snake_case arguments as an OutreachBrief, dropping empty values. */
export function briefFromArgs(a: Record<string, unknown>): OutreachBrief {
  const b: OutreachBrief = {}
  const set = <K extends keyof OutreachBrief>(k: K, v: OutreachBrief[K] | undefined) => {
    if (v !== undefined) b[k] = v
  }
  set('whatTheyDo', str(a.what_they_do))
  set('audience', str(a.audience))
  const hl = Array.isArray(a.highlights) ? a.highlights.map(str).filter((x): x is string => !!x).slice(0, 10) : []
  if (hl.length) b.highlights = hl
  if (a.contact && typeof a.contact === 'object') {
    const c = a.contact as Record<string, unknown>
    const contact = { phone: str(c.phone), email: str(c.email), whatsapp: str(c.whatsapp) }
    const kept = Object.fromEntries(Object.entries(contact).filter(([, v]) => v)) as OutreachBrief['contact']
    if (kept && Object.keys(kept).length) b.contact = kept
  }
  set('hours', str(a.hours))
  set('address', str(a.address))
  set('style', str(a.style))
  if (isLang(a.language)) b.language = a.language
  return b
}
