import { outreachPool } from '../db'
import { isSuppressed } from '../suppress'
import type { OutreachContact } from '../types'
import { pendingTaskCount } from './runs'
import type { AgentLimits, ToolDef } from './types'

// Enforcement that no skill can switch off (docs/plans/OUTREACH_AGENT_SKILLS.md §4). Quota helpers return a refusal
// code, or null when the action may go ahead.

const IST_MS = 330 * 60_000
const DAY_MS = 86_400_000

/** Start of the IST day containing `at`. */
export function istDayStart(at: Date): Date {
  const shifted = at.getTime() + IST_MS
  return new Date(shifted - (shifted % DAY_MS) - IST_MS)
}

/** These pass the gate even for an opted-out or suppressed contact (stopping, handing off and notes only record). */
const ALWAYS = new Set(['optOut', 'handOff', 'logOutcome'])

/** Refusal code for a side effect on this contact, or null: 'opted_out' | 'suppressed'. */
export async function contactGate(contact: OutreachContact, tool: ToolDef): Promise<string | null> {
  if (tool.effect === 'read' || ALWAYS.has(tool.name)) return null
  if (contact.opted_out_at || contact.status === 'opted_out') return 'opted_out'
  if (contact.status === 'suppressed' || (await isSuppressed(contact.phone))) return 'suppressed'
  return null
}

export const maskPhone = (p: string | null | undefined): string => {
  const d = String(p ?? '').replace(/\D/g, '')
  return d ? `••••${d.slice(-4)}` : ''
}

const DENIALS: RegExp[] = [
  /\b(?:i\s*am|i'?m|i’m)\s+(?:not|no)\s+(?:an?\s+|a\s+real\s+)?(?:ai|a\.i\.|bot|chat\s?bot|robot|machine|virtual|automated|artificial|computer|program)\b/i,
  /\b(?:i\s*am|i'?m|i’m)\s+(?:an?\s+)?(?:real|actual|live|living)\s+(?:person|human|woman|man|girl|lady|being)\b/i,
  /\b(?:i\s*am|i'?m|i’m)\s+(?:a\s+)?(?:human|person)\b(?!\s+(?:assistant|team))/i,
  /\b(?:this|that)\s+(?:is|was)\s+not\s+(?:an?\s+)?(?:ai|bot|robot|machine|automated)\b/i,
  /\byou(?:'re|’re| are)\s+(?:talking|speaking|chatting)\s+(?:to|with)\s+(?:an?\s+)?(?:real|actual|live)?\s*(?:human|person)\b/i,
  /\bnot\s+(?:an?\s+)?(?:ai|bot|robot)\b/i,
  /मैं\s*(?:एक\s*)?(?:असली\s*|सच[्मुच]*\s*का\s*)?(?:इंसान|इन्सान|मनुष्य|व्यक्ति|आदमी|औरत|लड़की)\s*(?:हूँ|हूं|हु)/,
  /मैं\s*(?:कोई\s*|एक\s*)?(?:बॉट|बोट|रोबोट|रोबॉट|एआई|ए\.?\s?आई\.?|मशीन|AI)\s*(?:नहीं|नही)/i,
  /(?:यह|ये)\s*(?:कोई\s*)?(?:बॉट|रोबोट|एआई|मशीन)\s*(?:नहीं|नही)/,
  /\bmain\s+(?:ek\s+)?(?:asli\s+)?(?:insaan|insan|admi|aadmi)\s+(?:hoon|hun|hu)\b/i,
  /\bmain\s+(?:koi\s+)?(?:bot|robot|ai|machine)\s+(?:nahi|nahin)\b/i,
]

/** True when a reply claims to be human or denies being an AI ("I'm not a bot", "I am a real person", "मैं इंसान हूँ"...). */
export function deniesBeingAi(text: string): boolean {
  const t = String(text ?? '')
  return !!t && DENIALS.some(re => re.test(t))
}

/** 'template_limit' | 'text_limit': outbound WhatsApp per contact (failed sends do not count). */
export async function sendQuota(contactId: string, kind: 'template' | 'text', limits: AgentLimits, now: Date): Promise<string | null> {
  const day = new Date(now.getTime() - DAY_MS)
  const week = new Date(now.getTime() - 7 * DAY_MS)
  const isTemplate = kind === 'template'
  const r = await outreachPool().query(
    `SELECT count(*) FILTER (WHERE created_at > $2)::int AS day, count(*)::int AS week
       FROM outreach_messages
      WHERE contact_id = $1 AND direction = 'out' AND template_slug IS ${isTemplate ? 'NOT NULL' : 'NULL'} AND status IS DISTINCT FROM 'failed' AND created_at > $3`,
    [contactId, day, isTemplate ? week : day]
  )
  const n = r.rows[0] ?? {}
  if (isTemplate) return Number(n.day) >= limits.maxTemplatesPerDay || Number(n.week) >= limits.maxTemplatesPerWeek ? 'template_limit' : null
  return Number(n.day) >= limits.maxTextsPerDay ? 'text_limit' : null
}

/** 'call_limit': agent-scheduled calls in total and per IST day (counted from the dialler's 'agent_call' events). */
export async function agentCallQuota(contactId: string, limits: AgentLimits, now: Date): Promise<string | null> {
  const r = await outreachPool().query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at >= $2)::int AS today FROM outreach_events WHERE contact_id = $1 AND kind = 'agent_call'`,
    [contactId, istDayStart(now)]
  )
  const n = r.rows[0] ?? {}
  return Number(n.total) >= limits.maxAgentCalls || Number(n.today) >= limits.maxAgentCallsPerDay ? 'call_limit' : null
}

/** 'task_limit': too many pending tasks. */
export async function taskQuota(contactId: string, limits: AgentLimits): Promise<string | null> {
  return (await pendingTaskCount(contactId)) >= limits.maxPendingTasks ? 'task_limit' : null
}

/** Clamp a requested task time: >= now+followUpMinMinutes; null when beyond now+followUpMaxDays or invalid. */
export function taskTime(when: Date, now: Date, limits: AgentLimits): Date | null {
  const t = when.getTime()
  if (Number.isNaN(t)) return null
  if (t > now.getTime() + limits.followUpMaxDays * DAY_MS) return null
  const earliest = now.getTime() + limits.followUpMinMinutes * 60_000
  return new Date(Math.max(t, earliest))
}

const COST = `CASE WHEN e.data->>'costPaise' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (e.data->>'costPaise')::numeric ELSE 0 END`

/** Gateway turn budget for the IST day: 'turn_limit' | 'spend_limit' | 'program_spend_limit' | null. */
export async function turnBudget(contact: Pick<OutreachContact, 'id' | 'program'>, limits: AgentLimits, now: Date): Promise<string | null> {
  const pool = outreachPool()
  const since = istDayStart(now)
  const [own, program] = await Promise.all([
    pool.query(`SELECT count(*)::int AS turns, COALESCE(sum(${COST}), 0)::float AS spend FROM outreach_events e WHERE e.contact_id = $1 AND e.kind = 'agent_turn' AND e.created_at >= $2`, [contact.id, since]),
    pool.query(
      `SELECT COALESCE(sum(${COST}), 0)::float AS spend FROM outreach_events e JOIN outreach_contacts c ON c.id = e.contact_id WHERE c.program = $1 AND e.kind = 'agent_turn' AND e.created_at >= $2`,
      [contact.program, since]
    ),
  ])
  const o = own.rows[0] ?? {}
  if (Number(o.turns) >= limits.maxTurnsPerDay) return 'turn_limit'
  if (Number(o.spend) >= limits.maxSpendPaisePerContactDay) return 'spend_limit'
  if (Number(program.rows[0]?.spend) >= limits.maxSpendPaisePerProgramDay) return 'program_spend_limit'
  return null
}
