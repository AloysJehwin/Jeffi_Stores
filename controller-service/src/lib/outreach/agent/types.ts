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

export const TOOL_GROUPS = ['core', 'messaging', 'orders', 'reviews', 'checkout', 'catalog', 'support', 'showcase', 'voice'] as const
export type ToolGroup = (typeof TOOL_GROUPS)[number]

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
  /** The task-agent job this run serves; absent/null for a Showcase lead run. */
  job_id?: string | null
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

export const JOB_SOURCES = ['csv', 'sheet', 'form', 'api', 'event', 'test'] as const
export type JobSource = (typeof JOB_SOURCES)[number]

/** queued: waiting to start (due_at, or another live job on the same phone); active: its run is live; waiting: a
 *  follow-up or callback is scheduled; the rest are terminal. */
export const JOB_STATUSES = ['queued', 'active', 'waiting', 'completed', 'failed', 'cancelled', 'handed_off'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
export const OPEN_JOB_STATUSES: readonly JobStatus[] = ['queued', 'active', 'waiting']

/** Safe summaries of the job's references, resolved on the server (agent/store/refs.ts). No phone, email or address. */
export interface OrderRef {
  id: string
  number: string
  status: string
  paymentStatus: string | null
  paymentMethod: string | null
  /** Rupees, formatted ("₹1,240"). */
  total: string
  itemCount: number
  /** "Drill set and 2 more" */
  itemsShort: string
  placedAt: string
  deliveredAt: string | null
  hasTracking: boolean
}
export interface CheckoutRef {
  /** cart:<userId> or order:<orderId> (a failed or abandoned checkout) */
  key: string
  kind: 'cart' | 'checkout'
  total: string
  itemCount: number
  itemsShort: string
  at: string
}
export interface ProductRef { id: string; name: string; price: string; inStock: boolean; slug: string | null }
export interface CustomerRef { userId: string; firstName: string | null; orderCount: number; lastOrderAt: string | null }
export interface ResolvedRefs {
  order?: OrderRef
  checkout?: CheckoutRef
  product?: ProductRef
  customer?: CustomerRef
}

export interface JobRow {
  id: string
  skill_id: string
  skill_version_id: string | null
  contact_id: string
  inputs: Record<string, unknown>
  refs: ResolvedRefs
  source: JobSource
  source_ref: string | null
  status: JobStatus
  outcome: string | null
  due_at: string
  attempts: number
  result: Record<string, unknown> | null
  created_by: string | null
  created_at: string
  updated_at: string
  ended_at: string | null
}

export interface ToolContext {
  channel: AgentChannel
  /** The task-agent job this turn serves; null for a Showcase lead run that predates jobs. */
  job: JobRow | null
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
  /** Catalog area for the admin tool picker; defaults to 'showcase' for the original tools. */
  group?: ToolGroup
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

// Task agents (docs/plans/OUTREACH_AGENTS.md): a skill that declares inputs and a trigger runs as jobs.

/** promotional adds DND and the marketing opt-out; transactional keeps opt-out, suppression and the calling window. */
export const PURPOSES = ['transactional', 'promotional'] as const
export type AgentPurpose = (typeof PURPOSES)[number]

/** Who the agent talks to: a business lead (Showcase, program 'showcase') or a flagship-store shopper (program 'store'). */
export const AUDIENCES = ['lead', 'shopper'] as const
export type AgentAudience = (typeof AUDIENCES)[number]
export const PROGRAM_OF: Record<AgentAudience, string> = { lead: 'showcase', shopper: 'store' }

export const INPUT_TYPES = [
  'text', 'phone', 'email', 'number', 'money', 'date', 'datetime', 'url', 'enum', 'boolean', 'language',
  'order_ref', 'checkout_ref', 'product_ref', 'customer_ref',
] as const
export type InputType = (typeof INPUT_TYPES)[number]
export const REF_TYPES: readonly InputType[] = ['order_ref', 'checkout_ref', 'product_ref', 'customer_ref']

/** contact: the phone the job reaches (exactly one per agent); name and language fill the contact row. */
export const INPUT_ROLES = ['contact', 'name', 'language'] as const
export type InputRole = (typeof INPUT_ROLES)[number]

export interface InputSpec {
  type: InputType
  required: boolean
  role: InputRole | null
  description: string | null
  /** type enum only */
  enum: string[] | null
}

export const TRIGGER_EVENTS = ['manual', 'order.delivered', 'order.placed', 'checkout.abandoned', 'payment.failed', 'review.missing'] as const
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number]

export interface TriggerSpec {
  event: TriggerEvent
  /** Minutes after the event before the job is due (frontmatter `delay: 2d | 6h | 30m`). */
  delayMinutes: number
  /** How far back the trigger looks for events (frontmatter `lookback: 7d`; default 3 days, at most 30). */
  lookbackMinutes: number
  /** Input whose value makes the job unique per agent (outreach_jobs.source_ref). */
  dedupe: string | null
  /** Optional filters the event query understands, e.g. { payment_method: cod, min_total: 500 }. */
  when: Record<string, string | number | boolean>
}

export interface SkillMeta {
  name: string
  title: string
  description: string | null
  flow: SkillFlow
  /** Task-agent keys; a skill without them is a Showcase lead skill (audience lead, trigger manual, no inputs). */
  audience: AgentAudience
  purpose: AgentPurpose
  inputs: Record<string, InputSpec>
  trigger: TriggerSpec
  /** The codes setOutcome accepts (slugs). Empty: setOutcome takes any slug. */
  outcomes: string[]
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
  /** Task agents: the job's inputs and resolved references, for {{inputs.x}} and {{order.x}} placeholders. */
  audience?: AgentAudience
  inputs?: Record<string, unknown>
  refs?: ResolvedRefs
  /** The flagship store's name for {{store}}; defaults to render.ts STORE_NAME. */
  store?: string
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
