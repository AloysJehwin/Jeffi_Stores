import { LANGUAGES, type OutreachLanguage } from '../../types'
import { TOOLS } from '../catalog'
import { limitKey } from '../limits'
import { CHANNELS, FLOWS, type AgentChannel, type AgentLimits, type ParsedSkill, type SkillFlow, type SkillIssue, type SkillMeta } from '../types'
import { parseFrontmatter } from './frontmatter'

const err = (code: string, message: string, line?: number): SkillIssue => ({ level: 'error', code, message, line })
const warn = (code: string, message: string, line?: number): SkillIssue => ({ level: 'warning', code, message, line })

const KNOWN_KEYS = ['name', 'title', 'description', 'flow', 'channels', 'languages', 'default_language', 'persona', 'tone', 'tools', 'limits', 'script_version', 'version']

/** snake_case, camelCase and kebab-case keys all mean the same key. */
const snake = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase()

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

const SECTION_OF: Record<string, AgentChannel> = { voice: 'voice', whatsapp: 'whatsapp', followup: 'follow_up', followups: 'follow_up' }
/** "## Follow-up", "Follow up", "Followup", "Follow-ups" → follow_up; the same for Voice and WhatsApp. */
export const sectionChannel = (heading: string): AgentChannel | null => SECTION_OF[heading.toLowerCase().replace(/[^a-z]/g, '')] ?? null

const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)

function asList(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(x => String(x ?? '').trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map(x => x.trim()).filter(Boolean)
  return null
}

interface Split {
  preamble: string
  sections: Partial<Record<AgentChannel, string>>
  heading: string | null
  issues: SkillIssue[]
}

function splitBody(body: string, bodyLine: number): Split {
  const issues: SkillIssue[] = []
  const lines = body.split('\n')
  const pre: string[] = []
  const parts: Partial<Record<AgentChannel, string[]>> = {}
  let cur: string[] = pre
  let heading: string | null = null
  let fence = false
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence) {
      const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(line)
      if (h1 && heading === null) heading = h1[1]
      const h2 = /^##\s+(.+?)\s*#*\s*$/.exec(line)
      const ch = h2 ? sectionChannel(h2[1]) : null
      if (ch) {
        if (parts[ch]) issues.push(warn('duplicate_section', `The "${h2![1]}" section appears twice; the two are joined`, bodyLine + i))
        cur = parts[ch] ??= []
        return
      }
    }
    cur.push(line)
  })
  const sections: Partial<Record<AgentChannel, string>> = {}
  for (const ch of CHANNELS) if (parts[ch]) sections[ch] = parts[ch]!.join('\n').trim()
  return { preamble: pre.join('\n').trim(), sections, heading, issues }
}

export function parseSkill(raw: string, opts: { builtin?: boolean } = {}): { skill: ParsedSkill | null; issues: SkillIssue[] } {
  const fm = parseFrontmatter(raw)
  const issues: SkillIssue[] = [...fm.issues]
  if (fm.issues.some(i => i.level === 'error')) return { skill: null, issues }

  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fm.data)) data[snake(k)] = v
  for (const k of Object.keys(data)) if (!KNOWN_KEYS.includes(k)) issues.push(warn('unknown_key', `Unknown frontmatter key "${k}" is ignored`))

  const split = splitBody(fm.body, fm.bodyLine)
  issues.push(...split.issues)

  // name
  let name = asText(data.name)
  if (name) {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(name)) {
      issues.push(err('bad_name', 'name must be lowercase letters, digits and hyphens (a slug), at most 60 characters'))
      name = slugify(name) || null
    }
  } else if (split.heading) {
    name = slugify(split.heading) || null
  }
  if (!name) {
    issues.push(err('missing_name', 'Give the skill a name: a name: key in the frontmatter or a "# Title" heading'))
    name = 'untitled'
  }

  // flow
  let flow: SkillFlow = 'one_call'
  if (data.flow != null) {
    const f = asText(data.flow)
    if (f && (FLOWS as readonly string[]).includes(f)) flow = f as SkillFlow
    else issues.push(err('unknown_flow', `Unknown flow "${String(data.flow)}"; use one of ${FLOWS.join(', ')}`))
  }

  // languages
  let languages: OutreachLanguage[] = [...LANGUAGES]
  if (data.languages != null) {
    const list = asList(data.languages)
    if (!list) issues.push(err('bad_languages', 'languages must be a list such as [en, hi]'))
    else {
      const ok: OutreachLanguage[] = []
      for (const l of list.map(x => x.toLowerCase())) {
        if ((LANGUAGES as readonly string[]).includes(l)) {
          if (!ok.includes(l as OutreachLanguage)) ok.push(l as OutreachLanguage)
        } else issues.push(err('unknown_language', `Unknown language "${l}"; use ${LANGUAGES.join(', ')}`))
      }
      if (ok.length) languages = ok
      else if (!list.length) issues.push(err('bad_languages', 'languages is empty'))
    }
  }
  let defaultLanguage: OutreachLanguage = languages.includes('en') ? 'en' : languages[0]
  if (data.default_language != null) {
    const d = (asText(data.default_language) ?? '').toLowerCase()
    if (!(LANGUAGES as readonly string[]).includes(d)) issues.push(err('unknown_language', `Unknown default_language "${d}"`))
    else if (!languages.includes(d as OutreachLanguage)) issues.push(err('default_language_not_listed', `default_language "${d}" is not in languages`))
    else defaultLanguage = d as OutreachLanguage
  }

  // channels: the live ones; follow_up comes from its section
  let channels: ('voice' | 'whatsapp')[] = (['voice', 'whatsapp'] as const).filter(c => split.sections[c] !== undefined)
  if (data.channels != null) {
    const list = asList(data.channels)
    if (!list) issues.push(err('bad_channels', 'channels must be a list such as [voice, whatsapp]'))
    else {
      const ok: ('voice' | 'whatsapp')[] = []
      for (const c of list.map(x => snake(x))) {
        if (c === 'voice' || c === 'whatsapp') {
          if (!ok.includes(c)) ok.push(c)
        } else if (c !== 'follow_up') issues.push(err('unknown_channel', `Unknown channel "${c}"; use voice or whatsapp (follow_up comes from a "## Follow-up" section)`))
      }
      channels = ok
    }
  }

  // persona
  const persona: Partial<Record<OutreachLanguage, string>> = {}
  if (data.persona != null) {
    if (typeof data.persona !== 'object' || Array.isArray(data.persona)) issues.push(err('bad_persona', 'persona must be a map of language to a human name'))
    else {
      for (const [l, n] of Object.entries(data.persona as Record<string, unknown>)) {
        const lang = l.toLowerCase()
        const nm = asText(n)
        if (!(LANGUAGES as readonly string[]).includes(lang)) issues.push(warn('unknown_persona_language', `persona.${l}: unknown language, ignored`))
        else if (!nm || nm.length > 40) issues.push(err('bad_persona', `persona.${l} must be a name of at most 40 characters`))
        else persona[lang as OutreachLanguage] = nm
      }
    }
  }

  // tools: a list applies to every channel (keeping what can run there); a map is per channel
  const tools: Record<AgentChannel, string[]> = { voice: [], whatsapp: [], follow_up: [] }
  const dedupe = (a: string[]) => [...new Set(a)]
  if (data.tools != null) {
    if (Array.isArray(data.tools) || typeof data.tools === 'string') {
      const list = dedupe(asList(data.tools) ?? [])
      for (const ch of CHANNELS) tools[ch] = list.filter(n => !TOOLS[n] || TOOLS[n].channels.includes(ch))
    } else if (typeof data.tools === 'object') {
      for (const [k, v] of Object.entries(data.tools as Record<string, unknown>)) {
        const ch = snake(k)
        if (!(CHANNELS as readonly string[]).includes(ch)) {
          issues.push(err('unknown_tools_channel', `tools.${k}: use voice, whatsapp or follow_up`))
          continue
        }
        const list = v == null ? [] : asList(v)
        if (!list) issues.push(err('bad_tools', `tools.${k} must be a list of tool names`))
        else tools[ch as AgentChannel] = dedupe(list)
      }
    } else issues.push(err('bad_tools', 'tools must be a list or a map of channel to a list'))
  } else {
    issues.push(warn('no_tools', 'No tools listed: the agent only gets optOut and handOff'))
  }

  // limits
  const limits: Partial<AgentLimits> = {}
  if (data.limits != null) {
    if (typeof data.limits !== 'object' || Array.isArray(data.limits)) issues.push(err('bad_limits', 'limits must be a map such as max_agent_calls: 2'))
    else {
      for (const [k, v] of Object.entries(data.limits as Record<string, unknown>)) {
        const key = limitKey(k)
        if (!key) issues.push(err('unknown_limit', `Unknown limit "${k}"`))
        else if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) issues.push(err('bad_limit', `limits.${k} must be a positive whole number`))
        else limits[key] = v
      }
    }
  }

  const meta: SkillMeta = {
    name,
    title: asText(data.title) ?? name,
    description: asText(data.description),
    flow,
    channels,
    languages,
    defaultLanguage,
    persona,
    tone: asText(data.tone),
    tools,
    limits,
    scriptVersion: opts.builtin ? asText(data.script_version) : null,
  }
  return { skill: { meta, preamble: split.preamble, sections: split.sections, raw }, issues }
}
