import { LANGUAGE_NAMES, LINES, PERSONA_NAMES, PERSONA_RULE, isLanguage, istStamp, knownLines } from '../../prompt'
import type { OutreachLanguage } from '../../types'
import type { AgentChannel, AgentTrigger, InputSpec, ParsedSkill, RenderContext } from '../types'

export const PLACEHOLDERS: readonly string[] = ['business', 'owner', 'persona', 'city', 'category', 'language', 'now_ist', 'pitch', 'consent_ask', 'ai_answer', 'trial_days', 'store']

/** {{order.number}} and friends: the fields a resolved reference offers a prompt. */
export const PLACEHOLDER_REFS: Record<string, readonly string[]> = {
  order: ['number', 'items_short', 'status', 'total', 'delivered_ago', 'placed_ago'],
  checkout: ['items_short', 'total', 'ago'],
  product: ['name', 'price'],
  customer: ['first_name'],
}

/** The flagship store's name for {{store}} and the shopper identity line. */
export const STORE_NAME = 'Jeffi Stores'

const shopper = (ctx: RenderContext) => ctx.audience === 'shopper'
const storeOf = (ctx: RenderContext) => ctx.store ?? STORE_NAME

/** "2 hours ago", "yesterday"; "recently" when the time is unknown. */
export function agoText(iso: string | null | undefined, now: Date): string {
  const t = iso ? new Date(iso).getTime() : NaN
  if (Number.isNaN(t)) return 'recently'
  const m = Math.max(0, Math.round((now.getTime() - t) / 60_000))
  if (m < 2) return 'just now'
  if (m < 60) return `${m} minutes ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** An input value as the prompt may show it: phone numbers and emails are masked. */
function inputText(spec: InputSpec | undefined, v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const t = String(v)
  switch (spec?.type) {
    case 'phone': return `••••${t.replace(/\D/g, '').slice(-4)}`
    case 'email': return t.replace(/^(.).*(@.*)$/, '$1•••$2')
    case 'datetime': return Number.isNaN(new Date(t).getTime()) ? t : istStamp(new Date(t))
    case 'date': return Number.isNaN(new Date(t).getTime()) ? t : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(t))
    case 'money': return Number.isFinite(Number(v)) ? `₹${Number(v).toLocaleString('en-IN')}` : t
    case 'boolean': return v === true || t === 'true' ? 'yes' : 'no'
    default: return t
  }
}

/** Values for {{order.x}}, {{checkout.x}}, {{product.x}}, {{customer.x}} from the job's resolved references. */
function refValues(ctx: RenderContext): Record<string, string> {
  const out: Record<string, string> = {}
  const { order, checkout, product, customer } = ctx.refs ?? {}
  if (order) {
    out['order.number'] = order.number
    out['order.items_short'] = order.itemsShort
    out['order.status'] = order.status
    out['order.total'] = order.total
    out['order.delivered_ago'] = agoText(order.deliveredAt, ctx.now)
    out['order.placed_ago'] = agoText(order.placedAt, ctx.now)
  }
  if (checkout) {
    out['checkout.items_short'] = checkout.itemsShort
    out['checkout.total'] = checkout.total
    out['checkout.ago'] = agoText(checkout.at, ctx.now)
  }
  if (product) {
    out['product.name'] = product.name
    out['product.price'] = product.price
  }
  if (customer) out['customer.first_name'] = customer.firstName ?? ''
  return out
}

export const TRIAL_DAYS = 7

/** The persona's human name: the skill's, or the code default for that language. */
export const personaNameFor = (skill: ParsedSkill, language: OutreachLanguage): string => skill.meta.persona[language] || PERSONA_NAMES[language]

/** The language to run in: the preferred one when the skill allows it, else the skill's default. */
export function skillLanguage(skill: ParsedSkill, preferred: unknown): OutreachLanguage {
  const l = typeof preferred === 'string' ? preferred.split('-')[0].toLowerCase() : ''
  return isLanguage(l) && skill.meta.languages.includes(l) ? l : skill.meta.defaultLanguage
}

/** Fills {{placeholders}}; unknown ones are left as written (validation warns). */
function fill(text: string, ctx: RenderContext, skill: ParsedSkill): string {
  const L = LINES[ctx.language]
  const values: Record<string, string> = {
    business: ctx.business,
    owner: ctx.owner ?? '',
    persona: ctx.personaName,
    city: ctx.city ?? '',
    category: ctx.category ?? '',
    language: LANGUAGE_NAMES[ctx.language].english,
    now_ist: istStamp(ctx.now),
    pitch: L.pitch(ctx.business),
    consent_ask: L.consentAsk,
    ai_answer: L.aiAnswer,
    trial_days: String(TRIAL_DAYS),
    store: storeOf(ctx),
    ...refValues(ctx),
  }
  return text.replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, (all, k: string) => {
    if (k.startsWith('inputs.')) {
      const name = k.slice(7)
      return ctx.inputs && name in skill.meta.inputs ? inputText(skill.meta.inputs[name], ctx.inputs[name]) : all
    }
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : all
  })
}

/** The preamble plus the channel's section, filled. */
function skillText(skill: ParsedSkill, channel: AgentChannel, ctx: RenderContext): string {
  const parts = [skill.preamble, skill.sections[channel] ?? ''].filter(p => p.trim())
  return fill(parts.join('\n\n'), ctx, skill).trim()
}

const consentLine = (ctx: RenderContext) => `- WhatsApp consent: ${ctx.consentWhatsApp ? 'already given; do not ask again' : 'not given yet'}`
/** "about their order 1042 (Drill set and 2 more)" for the shopper identity line. */
function shopperSubject(ctx: RenderContext): string {
  const { order, checkout, product } = ctx.refs ?? {}
  if (order) return `about their order ${order.number} (${order.itemsShort})`
  if (checkout) return `about the checkout they left (${checkout.itemsShort})`
  if (product) return `about ${product.name}`
  return 'about their account'
}
const siteLine = (ctx: RenderContext) =>
  `- Preview site: ${ctx.published ? 'already live' : ctx.previewStarted ? 'already started; do not call startPreview again' : 'not started'}`
const knownBlock = (ctx: RenderContext) => {
  const known = knownLines(ctx.known)
  return known.length ? ['- Details already collected (never ask for these again):', ...known] : []
}

function voicePrompt(skill: ParsedSkill, ctx: RenderContext): string {
  const L = LINES[ctx.language]
  const lang = LANGUAGE_NAMES[ctx.language]
  const about = [ctx.category, ctx.city].filter(Boolean).join(', ')
  const others = skill.meta.languages.filter(l => l !== ctx.language).map(l => `${LANGUAGE_NAMES[l].english} (${l})`).join(', ')
  const canSwitch = skill.meta.tools.voice.includes('switchLanguage') && others
  const identity = shopper(ctx)
    ? `You are ${ctx.personaName}, phoning on behalf of ${storeOf(ctx)}, an online store, ${shopperSubject(ctx)}. This is an outbound call to ${ctx.owner || 'a customer'}.`
    : `You are ${ctx.personaName}, phoning on behalf of Jeffi Stores, an Indian company that builds websites for small businesses. This is an outbound call to ${ctx.business}${ctx.owner ? ` (owner: ${ctx.owner})` : ''}${about ? `, ${about}` : ''}.`
  const languageBlock =
    `Speak only ${lang.english} (${lang.native}), in a warm, natural, spoken register. Everyday English words people in India use (website, link, WhatsApp, preview, online) are fine. ` +
    (canSwitch
      ? `If the person clearly prefers another language you support (${others}), call switchLanguage; do not switch mid-call yourself.`
      : `If the person prefers another language, say you can only continue in ${lang.english} and offer a call back.`) +
    (skill.meta.tone ? `\nTone: ${skill.meta.tone}.` : '')
  const safetyBlock = [
    PERSONA_RULE,
    `- You use a human name, ${ctx.personaName}, and a natural voice: short turns, light backchannels, no monologues.`,
    `- Do not volunteer that you are an AI. If the person sincerely asks whether you are a person, a bot or an AI, say truthfully: "${L.aiAnswer}" Never claim to be human.`,
    '- The greeting already said the call may be recorded so we get their details right. Say it again only if asked.',
  ].join('\n')
  const state = shopper(ctx) ? [consentLine(ctx)] : [consentLine(ctx), siteLine(ctx), ...knownBlock(ctx)]
  const continuing = ctx.continuing ? 'You have spoken with them before (a call back or a language switch). Pick up where things stand below; do not restart the pitch.\n\n' : ''
  return `${identity}\n\nLANGUAGE\n${languageBlock}\n\nWHO YOU ARE (hard rules; you are the caller)\n${safetyBlock}\n\n${skillText(skill, 'voice', ctx)}\n\n${continuing}WHERE THINGS STAND\n${state.join('\n')}\n\nScript version: ${ctx.scriptVersion}.`
}

/** Lines every non-voice prompt carries, whatever the skill says. */
function safetyLines(ctx: RenderContext): string[] {
  const L = LINES[ctx.language]
  if (shopper(ctx)) {
    return [
      `If they sincerely ask whether you are a person, a bot or an AI, say truthfully: "${L.aiAnswer}" Never claim to be human or deny being an AI.`,
      'Never say something worked (link sent, order confirmed, call booked) unless the tool you called returned ok.',
      'Never invent facts about the order, the products or the store; use only what they told you and what tools returned.',
      'If they ask us to stop messaging or contacting them, call optOut at once and nothing else.',
    ]
  }
  return [
    `If they sincerely ask whether you are a person, a bot or an AI, say truthfully: "${L.aiAnswer}" Never claim to be human or deny being an AI.`,
    'Never say something worked (link sent, change made, site live, call booked) unless the tool you called returned ok.',
    'Never invent facts about their business or about Jeffi Stores; use only what they told you and what tools returned.',
    'If they ask us to stop messaging or contacting them, call optOut at once and nothing else.',
  ]
}

const who = (ctx: RenderContext) => (shopper(ctx) ? ctx.owner || 'a customer' : `${ctx.owner || 'the owner'} of "${ctx.business}"${ctx.city ? ` in ${ctx.city}` : ''}`)

function stateBlock(ctx: RenderContext): string {
  const windowLine = ctx.windowOpen === undefined ? [] : [`- WhatsApp window: ${ctx.windowOpen ? 'open (free text allowed)' : 'closed (approved templates only)'}`]
  const lines = shopper(ctx)
    ? [consentLine(ctx), ...windowLine]
    : [`- Status: ${ctx.status}`, consentLine(ctx), ...windowLine, siteLine(ctx), ...knownBlock(ctx)]
  return `WHERE THINGS STAND\n${lines.join('\n')}`
}

function triggerLine(t: AgentTrigger | undefined): string {
  if (!t) return 'You were woken up to decide the next step.'
  switch (t.kind) {
    case 'inbound':
      return 'They just sent a WhatsApp message.'
    case 'follow_up':
      return `A follow-up you scheduled is due${t.reason ? ` (${t.reason})` : ''}.${t.instruction ? ` Your note to yourself: ${t.instruction}` : ''}`
    case 'call_ended':
      return `A call with them just ended${t.outcome ? ` (outcome: ${t.outcome})` : ''}.${t.summary ? ` Summary: ${t.summary}` : ''}`
    case 'call_unanswered':
      return `Your call to them was not answered (${t.status}).`
  }
}

function whatsappPrompt(skill: ParsedSkill, ctx: RenderContext): string {
  if (shopper(ctx)) {
    return [
      `You are the WhatsApp assistant of ${storeOf(ctx)}, chatting with ${who(ctx)} ${shopperSubject(ctx)}.`,
      `Reply in ${LANGUAGE_NAMES[ctx.language].english}.`,
      ...safetyLines(ctx),
      '',
      skillText(skill, 'whatsapp', ctx),
      '',
      stateBlock(ctx),
    ].join('\n')
  }
  const stage =
    ctx.status === 'claimed' ? 'The owner has claimed the site.'
    : ctx.status === 'published' ? 'The site is live; the owner has not claimed it yet.'
    : 'The site is a draft preview the owner is helping us fill in.'
  return [
    `You are the WhatsApp assistant of Jeffi Stores, chatting with ${who(ctx)}.`,
    stage,
    `Reply in ${LANGUAGE_NAMES[ctx.language].english}.`,
    ...safetyLines(ctx),
    '',
    skillText(skill, 'whatsapp', ctx),
    '',
    stateBlock(ctx),
  ].join('\n')
}

function followUpPrompt(skill: ParsedSkill, ctx: RenderContext): string {
  return [
    shopper(ctx) ? `You are the customer assistant of ${storeOf(ctx)}, deciding the next step for ${who(ctx)} ${shopperSubject(ctx)}.` : `You are the outreach assistant of Jeffi Stores, deciding the next step for ${who(ctx)}.`,
    'You are not in a conversation: act only through tools; nothing you write is sent.',
    triggerLine(ctx.trigger),
    `It is now ${istStamp(ctx.now)} IST. Anything you send goes out in ${LANGUAGE_NAMES[ctx.language].english}.`,
    ...safetyLines(ctx),
    '',
    skillText(skill, 'follow_up', ctx),
    '',
    stateBlock(ctx),
  ].join('\n')
}

/** The system prompt for one channel: code supplies identity, language, safety and state; the skill fills the middle. */
export function renderSystemPrompt(skill: ParsedSkill, ctx: RenderContext): string {
  if (ctx.channel === 'voice') return voicePrompt(skill, ctx)
  if (ctx.channel === 'whatsapp') return whatsappPrompt(skill, ctx)
  return followUpPrompt(skill, ctx)
}
