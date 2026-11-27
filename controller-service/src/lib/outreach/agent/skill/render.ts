import { LANGUAGE_NAMES, LINES, PERSONA_NAMES, PERSONA_RULE, isLanguage, istStamp, knownLines } from '../../prompt'
import type { OutreachLanguage } from '../../types'
import type { AgentChannel, AgentTrigger, ParsedSkill, RenderContext } from '../types'

export const PLACEHOLDERS: readonly string[] = ['business', 'owner', 'persona', 'city', 'category', 'language', 'now_ist', 'pitch', 'consent_ask', 'ai_answer', 'trial_days']

export const TRIAL_DAYS = 7

/** The persona's human name: the skill's, or the code default for that language. */
export const personaNameFor = (skill: ParsedSkill, language: OutreachLanguage): string => skill.meta.persona[language] || PERSONA_NAMES[language]

/** The language to run in: the preferred one when the skill allows it, else the skill's default. */
export function skillLanguage(skill: ParsedSkill, preferred: unknown): OutreachLanguage {
  const l = typeof preferred === 'string' ? preferred.split('-')[0].toLowerCase() : ''
  return isLanguage(l) && skill.meta.languages.includes(l) ? l : skill.meta.defaultLanguage
}

/** Fills {{placeholders}}; unknown ones are left as written (validation warns). */
function fill(text: string, ctx: RenderContext): string {
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
  }
  return text.replace(/\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g, (all, k: string) => (k in values ? values[k] : all))
}

/** The preamble plus the channel's section, filled. */
function skillText(skill: ParsedSkill, channel: AgentChannel, ctx: RenderContext): string {
  const parts = [skill.preamble, skill.sections[channel] ?? ''].filter(p => p.trim())
  return fill(parts.join('\n\n'), ctx).trim()
}

const consentLine = (ctx: RenderContext) => `- WhatsApp consent: ${ctx.consentWhatsApp ? 'already given; do not ask again' : 'not given yet'}`
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
  const identity = `You are ${ctx.personaName}, phoning on behalf of Jeffi Stores, an Indian company that builds websites for small businesses. This is an outbound call to ${ctx.business}${ctx.owner ? ` (owner: ${ctx.owner})` : ''}${about ? `, ${about}` : ''}.`
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
  const state = [consentLine(ctx), siteLine(ctx), ...knownBlock(ctx)]
  const continuing = ctx.continuing ? 'You have spoken with them before (a call back or a language switch). Pick up where things stand below; do not restart the pitch.\n\n' : ''
  return `${identity}\n\nLANGUAGE\n${languageBlock}\n\nWHO YOU ARE (hard rules; you are the caller)\n${safetyBlock}\n\n${skillText(skill, 'voice', ctx)}\n\n${continuing}WHERE THINGS STAND\n${state.join('\n')}\n\nScript version: ${ctx.scriptVersion}.`
}

/** Lines every non-voice prompt carries, whatever the skill says. */
function safetyLines(ctx: RenderContext): string[] {
  const L = LINES[ctx.language]
  return [
    `If they sincerely ask whether you are a person, a bot or an AI, say truthfully: "${L.aiAnswer}" Never claim to be human or deny being an AI.`,
    'Never say something worked (link sent, change made, site live, call booked) unless the tool you called returned ok.',
    'Never invent facts about their business or about Jeffi Stores; use only what they told you and what tools returned.',
    'If they ask us to stop messaging or contacting them, call optOut at once and nothing else.',
  ]
}

const who = (ctx: RenderContext) => `${ctx.owner || 'the owner'} of "${ctx.business}"${ctx.city ? ` in ${ctx.city}` : ''}`

function stateBlock(ctx: RenderContext): string {
  const lines = [
    `- Status: ${ctx.status}`,
    consentLine(ctx),
    ...(ctx.windowOpen === undefined ? [] : [`- WhatsApp window: ${ctx.windowOpen ? 'open (free text allowed)' : 'closed (approved templates only)'}`]),
    siteLine(ctx),
    ...knownBlock(ctx),
  ]
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
    `You are the outreach assistant of Jeffi Stores, deciding the next step for ${who(ctx)}.`,
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
