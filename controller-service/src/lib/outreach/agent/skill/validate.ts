import { MANDATORY_TOOLS, TOOLS } from '../catalog'
import { HARD_LIMITS } from '../limits'
import { CHANNELS, type AgentChannel, type SkillIssue, type SkillValidation } from '../types'
import { parseFrontmatter } from './frontmatter'
import { parseSkill } from './parse'
import { PLACEHOLDERS } from './render'

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
const CALL_ENDERS = ['markOutcome', 'endCall', 'scheduleCallback']

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
        const def = TOOLS[n]
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

    // warnings about behaviour
    if (meta.channels.includes('voice') && !meta.tools.voice.some(n => CALL_ENDERS.includes(n))) {
      issues.push(warn('no_call_ender', 'No voice tool ends a call gracefully (markOutcome, endCall or scheduleCallback)'))
    }
    if (sections.follow_up !== undefined && !meta.tools.follow_up.some(n => TOOLS[n] && SENDING.includes(TOOLS[n].effect))) {
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
    for (const m of line.matchAll(/\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g)) {
      if (!PLACEHOLDERS.includes(m[1]) && !seenPlaceholders.has(m[1])) {
        seenPlaceholders.add(m[1])
        issues.push(warn('unknown_placeholder', `Unknown placeholder {{${m[1]}}}; it is left as written`, at))
      }
    }
    if (!piiLine && (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(line) || [...line.matchAll(/\+?\d[\d\s().-]{8,}\d/g)].some(m => m[0].replace(/\D/g, '').length >= 10))) piiLine = at
  })
  if (piiLine) issues.push(warn('pii', 'The text contains something that looks like a phone number or an email; keep personal data out of skills', piiLine))

  const mandatory = [...MANDATORY_TOOLS]
  const toolNames = [...named, ...mandatory.filter(n => !named.includes(n))]
  return {
    ok: !issues.some(i => i.level === 'error'),
    issues,
    skill,
    tools: toolNames.map(name => ({ name, known: !!TOOLS[name], mandatory: mandatory.includes(name), channels: (TOOLS[name]?.channels ?? []) as AgentChannel[] })),
  }
}
