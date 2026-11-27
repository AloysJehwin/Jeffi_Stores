import { describe, it, expect } from 'vitest'
import { HARD_LIMITS, LIMIT_KEYS, effectiveLimits, limitKey } from '@controller/lib/outreach/agent/limits'

describe('limitKey', () => {
  it('maps snake_case and accepts camelCase', () => {
    expect(limitKey('max_agent_calls')).toBe('maxAgentCalls')
    expect(limitKey('max_templates_per_day')).toBe('maxTemplatesPerDay')
    expect(limitKey('max_spend_paise_per_program_day')).toBe('maxSpendPaisePerProgramDay')
    expect(limitKey('followUpMaxDays')).toBe('followUpMaxDays')
    expect(limitKey('nope')).toBeNull()
  })

  it('every limit has a snake_case spelling', () => {
    for (const k of LIMIT_KEYS) expect(limitKey(k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`))).toBe(k)
  })
})

describe('effectiveLimits', () => {
  it('is the hard limits with no skill, and never mutates them', () => {
    expect(effectiveLimits()).toEqual(HARD_LIMITS)
    effectiveLimits({ maxAgentCalls: 1 }).maxAgentCalls = 99
    expect(HARD_LIMITS.maxAgentCalls).toBe(3)
  })

  it('a skill can only lower a limit', () => {
    const l = effectiveLimits({ maxAgentCalls: 2, maxTemplatesPerDay: 100, followUpMinMinutes: 60 })
    expect(l.maxAgentCalls).toBe(2)
    expect(l.maxTemplatesPerDay).toBe(HARD_LIMITS.maxTemplatesPerDay)
    expect(l.followUpMinMinutes).toBe(15)
  })

  it('ignores non-positive and non-integer values', () => {
    const l = effectiveLimits({ maxAgentCalls: 0, maxTurnsPerDay: -1, maxTextsPerDay: 1.5, maxPendingTasks: NaN })
    expect(l).toEqual(HARD_LIMITS)
  })
})
