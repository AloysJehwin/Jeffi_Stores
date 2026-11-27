import type { AgentLimits } from './types'

// Hard limits of the outreach agent (docs/plans/OUTREACH_AGENT_SKILLS.md §4). A skill may only lower them.

export const HARD_LIMITS: AgentLimits = {
  maxCallAttempts: 3,
  maxAgentCalls: 3,
  maxAgentCallsPerDay: 2,
  maxTemplatesPerDay: 6,
  maxTemplatesPerWeek: 12,
  maxTextsPerDay: 20,
  maxTurnsPerDay: 30,
  maxPendingTasks: 3,
  followUpMinMinutes: 15,
  followUpMaxDays: 30,
  maxSpendPaisePerContactDay: 2000,
  maxSpendPaisePerProgramDay: 50000,
}

export const LIMIT_KEYS = Object.keys(HARD_LIMITS) as (keyof AgentLimits)[]

/** snake_case frontmatter key -> AgentLimits key (max_agent_calls -> maxAgentCalls); also accepts camelCase. */
export function limitKey(k: string): keyof AgentLimits | null {
  const key = String(k ?? '').trim()
  if ((LIMIT_KEYS as string[]).includes(key)) return key as keyof AgentLimits
  const camel = key.toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  return (LIMIT_KEYS as string[]).includes(camel) ? (camel as keyof AgentLimits) : null
}

/** min(skill, hard) per key; ignores non-positive / non-integer values. */
export function effectiveLimits(skill?: Partial<AgentLimits>): AgentLimits {
  const out = { ...HARD_LIMITS }
  for (const k of LIMIT_KEYS) {
    const v = skill?.[k]
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[k] = Math.min(v, HARD_LIMITS[k])
  }
  return out
}
