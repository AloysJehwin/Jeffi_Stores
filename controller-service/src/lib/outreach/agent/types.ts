import type { z } from 'zod'
import type { KnownBrief } from '../prompt'
import type { ContactStatus, OutreachCall, OutreachContact, OutreachLanguage } from '../types'

// Shared contracts of the outreach agent (docs/plans/OUTREACH_AGENT_SKILLS.md): the tool catalog, the skill file and
// the runtime code against these types only.

export const CHANNELS = ['voice', 'whatsapp', 'follow_up'] as const
export type AgentChannel = (typeof CHANNELS)[number]

export const FLOWS = ['one_call', 'two_call', 'whatsapp_only'] as const
export type SkillFlow = (typeof FLOWS)[number]

export type ToolEffect = 'read' | 'write' | 'send' | 'call'

/** Hard limits live in code (guards.ts HARD_LIMITS); a skill may only lower them. */
export interface AgentLimits {
  /** Unanswered dial attempts before a lead fails (worker + scheduleCallback before interest). */
  maxCallAttempts: number
  /** Agent-scheduled calls to an engaged contact (the second call and later), in total. */
  maxAgentCalls: number
  /** Agent-scheduled calls to one contact per IST day. */
  maxAgentCallsPerDay: number
  /** Outbound WhatsApp templates per contact per rolling 24 h / 7 days. */
  maxTemplatesPerDay: number
  maxTemplatesPerWeek: number
  /** Free-text WhatsApp sends per contact per rolling 24 h (only inside the 24 h window anyway). */
  maxTextsPerDay: number
  /** Gateway LLM turns (WhatsApp + follow-up) per contact per IST day. */
  maxTurnsPerDay: number
  /** Pending tasks per contact. */
  maxPendingTasks: number
  /** A scheduled task is at least this far ahead and at most followUpMaxDays out. */
  followUpMinMinutes: number
  followUpMaxDays: number
  /** Gateway AI spend, paise: per contact per IST day, and for the whole program per IST day. */
  maxSpendPaisePerContactDay: number
  maxSpendPaisePerProgramDay: number
}

export type AgentRunStatus = 'active' | 'handed_off' | 'completed' | 'stopped'

export interface AgentRunRow {
  id: string
  contact_id: string
  skill_version_id: string | null
  /** "<slug>@v<n>", or the builtin's script version: cited in consent evidence and audit rows. */
  skill_ref: string
  status: AgentRunStatus
  turns: number
  spend_paise: number
  last_channel: AgentChannel | null
  last_turn_at: string | null
  notes: unknown[]
  started_at: string
  updated_at: string
  ended_at: string | null
}

export type AgentTaskKind = 'call' | 'whatsapp_turn'
export type AgentTaskStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'failed'

export interface AgentTaskRow {
  id: string
  run_id: string
  contact_id: string
  kind: AgentTaskKind
  due_at: string
  reason: string | null
  instruction: string | null
  status: AgentTaskStatus
  attempts: number
  result: Record<string, unknown> | null
  created_by: string | null
  created_at: string
  done_at: string | null
}

/** Why the agent is taking a turn outside a live call. */
export type AgentTrigger =
  | { kind: 'inbound'; messageId: string }
  | { kind: 'follow_up'; taskId: string; reason: string | null; instruction: string | null }
  | { kind: 'call_ended'; callId: string; outcome: string | null; summary: string | null }
  | { kind: 'call_unanswered'; callId: string; status: string }

export interface ToolContext {
  channel: AgentChannel
  /** Fresh row, read just before the tool runs. */
  contact: OutreachContact
  /** The live call (voice only). */
  call: OutreachCall | null
  run: AgentRunRow | null
  language: OutreachLanguage
  now: Date
  /** 'voice' | 'outreach:whatsapp' | 'outreach:agent' | 'admin:<id>' */
  actor: string
  limits: AgentLimits
  /** Skill ref for evidence ("showcase-offer/2026-11-24.1" for the builtin default). */
  scriptVersion: string
}

export interface ToolResult {
  ok: boolean
  /** Voice: spoken verbatim and the LLM is not run again for that turn. Only ever a line from code. */
  say?: string
  /** Voice: hang up after `say`. */
  end?: boolean
  redialLanguage?: OutreachLanguage
  /** What the LLM sees. PII-safe: masked phones, never a claim link or token. */
  data?: Record<string, unknown>
  /** Short reason the LLM sees when ok is false (a refusal code or a sentence). */
  error?: string
  /** Audit only (outreach_events), never shown to the LLM. */
  detail?: Record<string, unknown>
}

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  description: string
  channels: readonly AgentChannel[]
  effect: ToolEffect
  /** Always offered, whatever the skill lists (optOut, handOff, getLead, logOutcome). */
  mandatory?: boolean
  args: S
  /** JSON Schema of the args, handed to the LLM. */
  inputSchema: Record<string, unknown>
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolResult>
}

/** Anthropic tool definition (what voice-service hands to Claude). */
export interface LlmToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface SkillMeta {
  name: string
  title: string
  description: string | null
  flow: SkillFlow
  /** The live channels the skill talks on; follow_up is implied by a "## Follow-up" section. */
  channels: ('voice' | 'whatsapp')[]
  languages: OutreachLanguage[]
  defaultLanguage: OutreachLanguage
  /** Persona name per language; a missing language falls back to the code default (prompt.ts PERSONA_NAMES). */
  persona: Partial<Record<OutreachLanguage, string>>
  tone: string | null
  /**
   * The allow-list per channel. Frontmatter `tools:` is either a list (every channel, each keeping the tools that can
   * run there) or a map `{voice: [...], whatsapp: [...], follow_up: [...]}`. Mandatory tools are added at run time.
   */
  tools: Record<AgentChannel, string[]>
  limits: Partial<AgentLimits>
  /** Builtin skills only: the script version cited in consent evidence. Ignored on uploads. */
  scriptVersion: string | null
}

export interface ParsedSkill {
  meta: SkillMeta
  /** Text before the first channel heading: shared by every channel. */
  preamble: string
  /** "## Voice", "## WhatsApp", "## Follow-up" bodies, without the heading line. */
  sections: Partial<Record<AgentChannel, string>>
  raw: string
}

export interface SkillIssue {
  level: 'error' | 'warning'
  code: string
  message: string
  line?: number
}

export interface SkillValidation {
  ok: boolean
  issues: SkillIssue[]
  skill: ParsedSkill | null
  /** Each tool the skill names, plus the mandatory ones, with whether it exists and where it can run. */
  tools: { name: string; known: boolean; mandatory: boolean; channels: AgentChannel[] }[]
}

export interface ResolvedSkill {
  skillId: string | null
  versionId: string | null
  version: number
  slug: string
  /** "<slug>@v<n>", or meta.scriptVersion for a builtin. */
  ref: string
  builtin: boolean
  skill: ParsedSkill
}

/** Everything a rendered system prompt may mention about the contact and where things stand. */
export interface RenderContext {
  channel: AgentChannel
  language: OutreachLanguage
  personaName: string
  business: string
  owner: string | null
  category: string | null
  city: string | null
  status: ContactStatus
  now: Date
  /** A previous answered call with this contact. */
  continuing: boolean
  consentWhatsApp: boolean
  previewStarted: boolean
  published: boolean
  known: KnownBrief
  /** Script version line (voice) / audit ref. */
  scriptVersion: string
  trigger?: AgentTrigger
  /** WhatsApp 24 h window open (free text allowed). */
  windowOpen?: boolean
}

/** The model behind a gateway turn. Production: aiChat through the AI gateway; tests and the E2E: a scripted brain. */
export interface AgentModelRequest {
  system: string
  messages: { role: 'user' | 'assistant' | 'tool'; content: string; tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[]; tool_call_id?: string; providerState?: unknown }[]
  tools: LlmToolSchema[]
  channel: AgentChannel
  contactId: string
}

export interface AgentModelReply {
  content: string
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[]
  providerState?: unknown
  costPaise: number
}

export type AgentModel = (req: AgentModelRequest) => Promise<AgentModelReply>
