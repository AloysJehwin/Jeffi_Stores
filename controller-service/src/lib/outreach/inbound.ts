import { aiChat, type AiChatMessage, type AiToolDef } from '@/lib/shared/ai-client'
import { markWhatsAppRead } from '@/lib/shared/whatsapp'
import { detectLang } from '@/lib/support/translate'
import { languageLabel } from '@/lib/support/types'
import { outreachPool } from './db'
import { recordEvent } from './events'
import { findActiveByPhone } from './contacts'
import { InvalidTransitionError, transition } from './state'
import { captureMode, recordInbound, sendOutreachText } from './whatsapp'
import { mergeBrief, requestChange, type OutreachBrief } from './build'
import { LANGUAGES, type OutreachContact, type OutreachLanguage } from './types'

// WhatsApp from an owner the outreach program is talking to (interested…claimed, last 30 days). The webhook sends
// it here before the shopper bot and never forwards it on. STOP in any supported language opts out at once (one
// confirmation); anything else is one Claude slot-filling turn that updates the brief or asks for a change through
// build.ts, then replies in the owner's language inside the 24h window.

const ACTOR = 'outreach:whatsapp'
const MAX_ITERATIONS = 4
const HISTORY = 12

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

export const OPT_OUT_CONFIRMATION: Record<OutreachLanguage, string> = {
  en: "Done. We won't send you any more WhatsApp messages. Sorry for the trouble.",
  hi: 'ठीक है। अब हम आपको WhatsApp पर कोई संदेश नहीं भेजेंगे। असुविधा के लिए क्षमा करें।',
  ta: 'சரி. இனி உங்களுக்கு WhatsApp-இல் எந்த செய்தியும் அனுப்ப மாட்டோம். சிரமத்திற்கு மன்னிக்கவும்.',
  te: 'సరే. ఇకపై మీకు WhatsApp లో ఎలాంటి సందేశాలు పంపము. అసౌకర్యానికి క్షమించండి.',
  kn: 'ಸರಿ. ಇನ್ನು ಮುಂದೆ ನಿಮಗೆ WhatsApp ನಲ್ಲಿ ಯಾವುದೇ ಸಂದೇಶ ಕಳುಹಿಸುವುದಿಲ್ಲ. ತೊಂದರೆಗಾಗಿ ಕ್ಷಮಿಸಿ.',
  ml: 'ശരി. ഇനി നിങ്ങൾക്ക് WhatsApp-ൽ സന്ദേശങ്ങൾ അയക്കില്ല. ബുദ്ധിമുട്ടിന് ക്ഷമിക്കണം.',
  mr: 'ठीक आहे. यापुढे आम्ही तुम्हाला WhatsApp वर कोणताही संदेश पाठवणार नाही. त्रासाबद्दल क्षमस्व.',
  bn: 'ঠিক আছে। আমরা আর আপনাকে WhatsApp-এ কোনো বার্তা পাঠাব না। অসুবিধার জন্য দুঃখিত।',
  gu: 'બરાબર. હવે અમે તમને WhatsApp પર કોઈ સંદેશ નહીં મોકલીએ. તકલીફ બદલ માફ કરશો.',
}

const FALLBACK_REPLY = {
  en: 'Thanks, we have your message. Our team will get back to you here shortly.',
  hi: 'धन्यवाद, आपका संदेश मिल गया है। हमारी टीम जल्द ही यहीं आपको जवाब देगी।',
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
  | { action: 'replied' | 'no_reply' | 'fallback'; reply?: string; tools: string[] }

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
  return runTurn(contact, lang)
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

const TOOLS: AiToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'update_details',
      description: 'Save business details the owner just gave for their website. Only include what they actually said. Returns what is still missing.',
      parameters: {
        type: 'object',
        properties: {
          what_they_do: { type: 'string', description: 'What the business does or sells' },
          audience: { type: 'string', description: 'Who their customers are' },
          highlights: { type: 'array', items: { type: 'string' }, description: 'What makes them special' },
          contact: {
            type: 'object',
            properties: { phone: { type: 'string' }, email: { type: 'string' }, whatsapp: { type: 'string' } },
            description: 'How customers reach them',
          },
          hours: { type: 'string', description: 'Opening hours' },
          address: { type: 'string', description: 'Shop or office address' },
          style: { type: 'string', description: 'The look they want' },
          language: { type: 'string', enum: [...LANGUAGES], description: 'Language of the website' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_change',
      description: 'Ask for a change to the website (text, photos, colours, sections). Pass their instruction in English.',
      parameters: { type: 'object', properties: { instruction: { type: 'string' } }, required: ['instruction'] },
    },
  },
  {
    type: 'function',
    function: { name: 'opt_out', description: 'The owner asked us to stop messaging or contacting them.', parameters: { type: 'object', properties: {} } },
  },
]

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

function systemPrompt(c: OutreachContact, lang: OutreachLanguage): string {
  const stage =
    c.status === 'claimed' ? 'The owner has claimed the site.'
    : c.status === 'published' ? 'The site is live; the owner has not claimed it yet.'
    : 'The site is a draft preview the owner is helping us fill in.'
  return [
    `You are the WhatsApp assistant of Jeffi Stores, chatting with ${c.owner_name || 'the owner'} of "${c.business_name}"${c.city ? ` in ${c.city}` : ''}.`,
    'On a phone call they agreed to a free Showcase website that we are building for them. This chat is where they send details or ask for changes.',
    stage,
    `Reply in ${languageLabel(lang) || 'English'}. Keep it short: one or two sentences, warm and plain, no markdown, no links.`,
    'When they give business details, call update_details with only what they actually said. Never invent or guess facts.',
    'When they ask to change something on the site, call request_change. Never say a change is done unless the tool returned ok.',
    'update_details tells you what is still missing: ask for at most one missing thing at a time, and do not ask again for something they already gave.',
    'If they ask us to stop messaging or contacting them, call opt_out.',
    "If they sincerely ask whether you are a person, say truthfully that you are Jeffi Stores' AI assistant. Never claim to be human.",
    'For anything else (prices, payments, complaints), say the team will get back to them here.',
  ].join('\n')
}

async function transcript(contactId: string): Promise<AiChatMessage[]> {
  const r = await outreachPool().query(
    `SELECT direction, body FROM outreach_messages WHERE contact_id = $1 AND body IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ${HISTORY}`,
    [contactId]
  )
  const out: AiChatMessage[] = []
  for (const m of (r.rows as { direction: string; body: string }[]).reverse()) {
    const role = m.direction === 'in' ? 'user' : 'assistant'
    const content = String(m.body).slice(0, 2000)
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n\n${content}`
    else out.push({ role, content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

async function runTool(contact: OutreachContact, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'update_details') {
    const brief = briefFromArgs(args)
    if (!Object.keys(brief).length) return { error: 'No details given' }
    const res = await mergeBrief(contact.id, brief)
    await recordEvent(contact.id, 'brief_updated', { actor: ACTOR, data: { via: 'whatsapp', fields: Object.keys(brief), building: res.building, missing: res.missing } })
    return res
  }
  if (name === 'request_change') {
    const instruction = str(args.instruction)
    if (!instruction) return { error: 'No instruction given' }
    const res = await requestChange(contact.id, instruction)
    await recordEvent(contact.id, 'change_requested', { actor: ACTOR, data: { via: 'whatsapp', instruction, ok: res.ok, summary: res.summary } })
    return res
  }
  return { error: `Unknown tool ${name}` }
}

async function runTurn(contact: OutreachContact, lang: OutreachLanguage): Promise<InboundResult> {
  const messages: AiChatMessage[] = [{ role: 'system', content: systemPrompt(contact, lang) }, ...(await transcript(contact.id))]
  const used: string[] = []
  let text = ''
  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const r = await aiChat({
        feature: 'outreach_whatsapp',
        modelHint: 'agent',
        cacheNamespace: 'platform',
        temperature: 0.3,
        maxTokens: 600,
        noCache: true,
        messages,
        tools: iter < MAX_ITERATIONS - 1 ? TOOLS : undefined,
      })
      if (!r.toolCalls?.length) {
        text = r.content
        break
      }
      const calls = r.toolCalls.map((tc, i) => ({ ...tc, id: tc.id || `call_${iter}_${i}` }))
      if (calls.some(tc => tc.name === 'opt_out')) {
        return { action: 'opted_out', confirmed: await optOut(contact, lang, { via: 'assistant' }) }
      }
      messages.push({
        role: 'assistant',
        content: r.content || '',
        tool_calls: calls.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: tc.arguments } })),
        providerState: r.providerState,
      })
      for (const tc of calls) {
        used.push(tc.name)
        let content: string
        try {
          content = JSON.stringify(await runTool(contact, tc.name, tc.arguments ?? {})).slice(0, 4000)
        } catch (e) {
          content = JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content })
      }
    }
  } catch (e) {
    console.error('[outreach] assistant failed', e instanceof Error ? e.message : e)
    await recordEvent(contact.id, 'whatsapp_assistant_failed', { actor: ACTOR, data: { error: e instanceof Error ? e.message : String(e), tools: used } })
    const reply = lang === 'hi' ? FALLBACK_REPLY.hi : FALLBACK_REPLY.en
    await sendOutreachText(contact.id, reply, { actor: ACTOR })
    return { action: 'fallback', reply, tools: used }
  }
  const reply = text.trim()
  if (!reply) return { action: 'no_reply', tools: used }
  await sendOutreachText(contact.id, reply, { actor: ACTOR })
  return { action: 'replied', reply, tools: used }
}
