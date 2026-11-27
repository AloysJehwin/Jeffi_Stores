import { MANIFEST_MANDATORY, manifestTool } from '../tool-manifest'
import { HARD_LIMITS } from '../limits'
import { CHANNELS, type AgentChannel, type InputType, type SkillIssue, type SkillMeta, type SkillValidation, type TriggerEvent } from '../types'
import { parseFrontmatter } from './frontmatter'
import { parseSkill } from './parse'
import { PLACEHOLDER_REFS, PLACEHOLDERS } from './render'

export const MAX_SKILL_BYTES = 24 * 1024

const err = (code: string, message: string, line?: number): SkillIssue => ({ level: 'error', code, message, line })
const warn = (code: string, message: string, line?: number): SkillIssue => ({ level: 'warning', code, message, line })

const NEG = /\b(?:never|not|no|don'?t|do\s+not|dont|must\s+not|mustn'?t|won'?t|shouldn'?t|should\s+not|cannot|can'?t|avoid|without)\b/i
const AI_WORDS = String.raw`(?:ai|a\.i\.|bot|robot|chatbot|machine|computer|automated|virtual\s+assistant|artificial)(?![A-Za-z])`
const HUMAN_WORDS = String.raw`(?:human|person|man|woman|people)`
const SAY = String.raw`(?:say|tell|claim|insist|state|assert|pretend|swear|lie)`

// A claim to be human or to be "not an AI". Negated forms ("never claim to be human") are allowed: they are the rule itself.
const CLAIMS: RegExp[] = [
  new RegExp(String.raw`\b${SAY}\b[^.\n]{0,30}?\b(?:you(?:'re|\s+are|\s+were)|you\s+be|to\s+be|as\s+if\s+you\s+(?:are|were))\s+(?:an?\s+)?(?:real\s+|actual\s+|live\s+)?${HUMAN_WORDS}\b`, 'i'),
  new RegExp(String.raw`\b${SAY}\b[^.\n]{0,30}?\b(?:you(?:'re|\s+are)\s+not|you\s+aren'?t|you(?:'re|\s+are)\s+no)\s+(?:an?\s+)?${AI_WORDS}\b`, 'i'),
  new RegExp(String.raw`\b(?:deny|denies|denying|hide|hiding|conceal|lie\s+about|lying\s+about)\b[^.\n]{0,30}?\b(?:being|that\s+you(?:'re|\s+are)|you(?:'re|\s+are)|it)\b[^.\n]{0,15}?\b${AI_WORDS}\b`, 'i'),
]
// Concealing the truth: the negation is part of the instruction. "Do not volunteer ..." is deliberately not here.
const CONCEAL = new RegExp(
  String.raw`\b(?:never|don'?t|do\s+not|must\s+not|mustn'?t|won'?t|should\s+not|shouldn'?t|cannot|can'?t|avoid)\s+(?:ever\s+)?(?:admit|reveal|disclose|confess|acknowledge|confirm|let\s+on|say|tell|mention|share|state|answer|respond|reply)\b[^.\n]{0,40}?\b(?:you(?:'re|\s+are)|being|it'?s|this\s+is)\s+(?:an?\s+)?(?:not\s+(?:a\s+)?human|${AI_WORDS})`,
  'i'
)

/** True when a line tells the agent to deny being an AI or to claim to be human. */
export function deniesAiInstruction(line: string): boolean {
  if (CONCEAL.test(line)) return true
  return CLAIMS.some(re => {
    const m = re.exec(line)
    // only the clause before the match counts as its negation
    return !!m && !NEG.test(line.slice(0, m.index).split(/[.;:!?]/).pop()!.slice(-25))
  })
}

const SENDING = ['send']
const CALL_ENDERS = ['markOutcome', 'setOutcome', 'endCall', 'scheduleCallback']

/** Showcase-only tools: they act on a lead's site, so a shopper agent cannot list them. */
const SHOWCASE_ONLY = ['getSiteStatus', 'startPreview', 'addDetails', 'requestChange', 'publishSite', 'sendLink']

/** Store tools and the reference input each needs (any one of the types). Tools not listed need none. */
const TOOL_NEEDS: Record<string, InputType[]> = {
  trackShipment: ['order_ref'],
  confirmCodOrder: ['order_ref'],
  sendReviewLink: ['order_ref'],
  recordRating: ['order_ref'],
  getReviewStatus: ['order_ref'],
  sendPaymentLink: ['order_ref', 'checkout_ref'],
  getAbandonedCheckout: ['checkout_ref'],
  sendCheckoutLink: ['checkout_ref'],
}

/** What each placeholder family needs declared: {{order.x}} needs an order_ref input, and so on. */
const REF_INPUT: Record<string, InputType> = { order: 'order_ref', checkout: 'checkout_ref', product: 'product_ref', customer: 'customer_ref' }

const ORDER_EVENTS: TriggerEvent[] = ['order.delivered', 'order.placed', 'review.missing', 'payment.failed']
const CHECKOUT_EVENTS: TriggerEvent[] = ['checkout.abandoned', 'payment.failed']
const WHEN_KEYS: Partial<Record<TriggerEvent, string[]>> = { 'order.placed': ['payment_method', 'min_total'] }

/** Whether an event's standard fields can fill an input (workstream B's findTriggerCandidates mapping). */
function eventSupplies(event: TriggerEvent, i: SkillMeta['inputs'][string]): boolean {
  if (i.role === 'contact' || i.role === 'name') return true
  switch (i.type) {
    case 'order_ref': return ORDER_EVENTS.includes(event)
    case 'checkout_ref': return CHECKOUT_EVENTS.includes(event)
    case 'customer_ref': case 'datetime': case 'date': case 'money': return true
    default: return false
  }
}

/** Rules for task agents (docs/plans/OUTREACH_AGENTS.md §2): inputs, trigger, outcomes, tools against references. */
function taskAgentIssues(meta: SkillMeta, issues: SkillIssue[]): void {
  const entries = Object.entries(meta.inputs)
  const contacts = entries.filter(([, i]) => i.role === 'contact')
  const shopper = meta.audience === 'shopper'
  if (contacts.length > 1) issues.push(err('many_contact_inputs', 'Only one input may have role: contact'))
  if (shopper && contacts.length === 0) issues.push(err('no_contact_input', 'A shopper agent needs one input with role: contact (the phone to reach), e.g. customer_phone: { type: phone, required: true, role: contact }'))
  for (const [n, i] of entries) {
    if (i.role === 'contact' && i.type !== 'phone') issues.push(err('bad_input_role', `inputs.${n}: the contact input must have type phone`))
    if (i.role === 'name' && i.type !== 'text') issues.push(err('bad_input_role', `inputs.${n}: a name input must have type text`))
    if (i.role === 'language' && i.type !== 'language') issues.push(err('bad_input_role', `inputs.${n}: a language input must have type language`))
  }
  const has = (t: InputType) => entries.some(([, i]) => i.type === t)
  const { trigger } = meta
  if (trigger.dedupe && !meta.inputs[trigger.dedupe]) issues.push(err('unknown_dedupe', `trigger.dedupe names "${trigger.dedupe}", which is not a declared input`))
  if (trigger.event !== 'manual') {
    if (!shopper) issues.push(err('lead_trigger', 'Event triggers run store events: set audience: shopper'))
    if (!trigger.dedupe) issues.push(err('trigger_needs_dedupe', 'An event trigger needs dedupe: <input> so one event makes one job'))
    for (const [n, i] of entries) {
      if (i.required && !eventSupplies(trigger.event, i)) issues.push(err('trigger_missing_input', `${trigger.event} cannot supply the required input "${n}" (${i.type}); make it optional or use trigger: manual`))
    }
    const allowed = WHEN_KEYS[trigger.event] ?? []
    for (const k of Object.keys(trigger.when)) if (!allowed.includes(k)) issues.push(warn('unknown_when', `trigger.when.${k} is not used by ${trigger.event}${allowed.length ? ` (it understands ${allowed.join(', ')})` : ''}`))
  } else if (Object.keys(trigger.when).length || trigger.delayMinutes) issues.push(warn('manual_trigger_options', 'delay and when only apply to an event trigger'))

  const listed = new Set<string>()
  for (const ch of CHANNELS) meta.tools[ch].forEach(n => listed.add(n))
  for (const n of listed) {
    const def = manifestTool(n)
    if (!def) continue
    if (shopper && SHOWCASE_ONLY.includes(n)) issues.push(err('shopper_showcase_tool', `${n} is a Showcase tool; a shopper agent cannot use it`))
    const needs = TOOL_NEEDS[n]
    if (needs && !needs.some(has)) issues.push(err('tool_needs_ref', `${n} needs an input of type ${needs.join(' or ')}${shopper ? '' : '; a lead agent cannot use store tools that need a reference'}`))
    if (n === 'getOrder' && !has('order_ref') && !listed.has('findOrders')) issues.push(err('tool_needs_ref', 'getOrder needs an input of type order_ref (or list findOrders)'))
    if (!shopper && def.group && ['orders', 'reviews', 'checkout', 'support'].includes(def.group) && !needs && n !== 'findOrders') issues.push(warn('lead_store_tool', `${n} is a store tool; a lead agent has no store customer`))
  }
  if (meta.outcomes.length && !listed.has('setOutcome')) issues.push(warn('outcomes_without_tool', 'outcomes are listed but no channel offers setOutcome, so no job can finish with one'))
  if (shopper && !listed.has('setOutcome')) issues.push(warn('no_set_outcome', 'Without setOutcome a job only closes when the conversation ends; add it to the tools'))
}


export function validateSkill(raw: string, opts: { builtin?: boolean } = {}): SkillValidation {
  const { skill, issues: parseIssues } = parseSkill(raw, opts)
  const issues: SkillIssue[] = [...parseIssues]

  if (Buffer.byteLength(raw, 'utf8') > MAX_SKILL_BYTES) issues.push(err('too_large', `The skill is larger than ${MAX_SKILL_BYTES / 1024} KB`))
  if (!raw.trim()) issues.push(err('empty', 'The skill is empty'))

  const named: string[] = []
  if (skill) {
    const { meta, sections } = skill

    const unknown = new Set<string>()
    // tools: every one exists and can run on the channel it is listed for
    for (const ch of CHANNELS) {
      for (const n of meta.tools[ch]) {
        if (!named.includes(n)) named.push(n)
        const def = manifestTool(n)
        if (!def) {
          if (!unknown.has(n)) issues.push(err('unknown_tool', `Unknown tool "${n}"; see the tool catalog`))
          unknown.add(n)
        } else if (!def.channels.includes(ch)) issues.push(err('tool_channel', `${n} cannot run on ${ch} (it runs on ${def.channels.join(', ')})`))
      }
    }

    // sections vs flow
    const voiceFlow = meta.flow === 'one_call' || meta.flow === 'two_call'
    if (voiceFlow && sections.voice === undefined) issues.push(err('voice_section_required', `A ${meta.flow} skill needs a "## Voice" section`))
    if (meta.flow === 'whatsapp_only' && meta.channels.includes('voice')) issues.push(err('whatsapp_only_voice', 'A whatsapp_only skill cannot list the voice channel'))
    if (!meta.channels.length) issues.push(err('no_channels', 'The skill has no channel: add a "## Voice" or "## WhatsApp" section'))
    for (const ch of meta.channels) {
      if (sections[ch] === undefined && !(ch === 'voice' && voiceFlow)) issues.push(err('missing_section', `channels lists ${ch} but there is no "## ${ch === 'voice' ? 'Voice' : 'WhatsApp'}" section`))
    }
    for (const ch of CHANNELS) if (sections[ch] === '') issues.push(warn('empty_section', `The ${ch} section is empty`))

    // limits above the hard limit are clamped at run time
    for (const [k, v] of Object.entries(meta.limits)) {
      const hard = HARD_LIMITS[k as keyof typeof HARD_LIMITS]
      if (typeof v === 'number' && typeof hard === 'number' && v > hard) issues.push(warn('limit_clamped', `limits.${k} is ${v}, above the hard limit of ${hard}; ${hard} will be used`))
    }

    taskAgentIssues(meta, issues)

    // warnings about behaviour
    if (meta.channels.includes('voice') && !meta.tools.voice.some(n => CALL_ENDERS.includes(n))) {
      issues.push(warn('no_call_ender', 'No voice tool ends a call gracefully (markOutcome, endCall or scheduleCallback)'))
    }
    if (sections.follow_up !== undefined && !meta.tools.follow_up.some(n => { const t = manifestTool(n); return !!t && SENDING.includes(t.effect) })) {
      issues.push(warn('follow_up_no_sender', 'The Follow-up section has no tool that sends anything (sendLink, sendWhatsAppTemplate, ...)'))
    }
  }

  // text checks run on the body (the frontmatter is data)
  const fm = parseFrontmatter(raw)
  const lines = fm.body.split('\n')
  const seenPlaceholders = new Set<string>()
  let piiLine = 0
  lines.forEach((line, i) => {
    const at = fm.bodyLine + i
    if (deniesAiInstruction(line)) issues.push(err('denies_ai', 'Skills may not tell the agent to deny being an AI or to claim to be human. The agent says truthfully that it is an AI assistant when sincerely asked', at))
    for (const m of line.matchAll(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g)) {
      const key = m[1]
      if (seenPlaceholders.has(key)) continue
      const dot = key.indexOf('.')
      const [family, field] = dot < 0 ? [key, ''] : [key.slice(0, dot), key.slice(dot + 1)]
      if (family === 'inputs' && field) {
        seenPlaceholders.add(key)
        if (skill && !skill.meta.inputs[field]) issues.push(err('unknown_input_placeholder', `{{${key}}} refers to an input that is not declared in inputs:`, at))
      } else if (Object.prototype.hasOwnProperty.call(PLACEHOLDER_REFS, family)) {
        seenPlaceholders.add(key)
        if (!PLACEHOLDER_REFS[family].includes(field)) issues.push(warn('unknown_placeholder', `Unknown placeholder {{${key}}}; it is left as written`, at))
        else if (skill && !Object.values(skill.meta.inputs).some(i => i.type === REF_INPUT[family])) {
          issues.push(err('placeholder_needs_ref', `{{${key}}} needs an input of type ${REF_INPUT[family]}`, at))
        }
      } else if (!PLACEHOLDERS.includes(key)) {
        seenPlaceholders.add(key)
        issues.push(warn('unknown_placeholder', `Unknown placeholder {{${key}}}; it is left as written`, at))
      }
    }
    if (!piiLine && (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(line) || [...line.matchAll(/\+?\d[\d\s().-]{8,}\d/g)].some(m => m[0].replace(/\D/g, '').length >= 10))) piiLine = at
  })
  if (piiLine) issues.push(warn('pii', 'The text contains something that looks like a phone number or an email; keep personal data out of skills', piiLine))

  const mandatory = [...MANIFEST_MANDATORY]
  const toolNames = [...named, ...mandatory.filter(n => !named.includes(n))]
  return {
    ok: !issues.some(i => i.level === 'error'),
    issues,
    skill,
    tools: toolNames.map(name => ({ name, known: !!manifestTool(name), mandatory: mandatory.includes(name), channels: [...(manifestTool(name)?.channels ?? [])] as AgentChannel[] })),
  }
}
