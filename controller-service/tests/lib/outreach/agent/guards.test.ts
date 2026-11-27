import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn(), isSuppressed: vi.fn() }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/suppress', () => ({ isSuppressed: h.isSuppressed }))

import { agentCallQuota, contactGate, deniesBeingAi, istDayStart, maskPhone, sendQuota, taskQuota, taskTime, turnBudget } from '@controller/lib/outreach/agent/guards'
import { HARD_LIMITS } from '@controller/lib/outreach/agent/limits'
import type { ToolDef } from '@controller/lib/outreach/agent/types'

// 11:30 IST
const NOW = new Date('2026-11-27T06:00:00Z')
const tool = (name: string, effect: ToolDef['effect']) => ({ name, effect }) as ToolDef
const contact = (o: Record<string, unknown> = {}) => ({ id: 'k1', phone: '+919876543210', status: 'interested', opted_out_at: null, program: 'showcase-offer', ...o }) as any

beforeEach(() => {
  vi.clearAllMocks()
  h.isSuppressed.mockResolvedValue(false)
  h.query.mockResolvedValue({ rows: [{}] })
})

describe('contactGate', () => {
  it('lets reads, optOut, handOff and logOutcome through for anyone', async () => {
    const stopped = contact({ status: 'opted_out', opted_out_at: '2026-11-27T05:00:00Z' })
    for (const t of [tool('getLead', 'read'), tool('optOut', 'write'), tool('handOff', 'write'), tool('logOutcome', 'write')]) expect(await contactGate(stopped, t)).toBeNull()
  })

  it('refuses side effects for opted-out and suppressed contacts', async () => {
    expect(await contactGate(contact({ status: 'opted_out' }), tool('sendLink', 'send'))).toBe('opted_out')
    expect(await contactGate(contact({ opted_out_at: '2026-11-27T05:00:00Z' }), tool('markOutcome', 'write'))).toBe('opted_out')
    expect(await contactGate(contact({ status: 'suppressed' }), tool('sendLink', 'send'))).toBe('suppressed')
    h.isSuppressed.mockResolvedValueOnce(true)
    expect(await contactGate(contact(), tool('sendLink', 'send'))).toBe('suppressed')
    expect(await contactGate(contact(), tool('sendLink', 'send'))).toBeNull()
  })
})

describe('maskPhone', () => {
  it('keeps the last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('••••3210')
    expect(maskPhone('98765 43210')).toBe('••••3210')
    expect(maskPhone(null)).toBe('')
    expect(maskPhone('')).toBe('')
  })
})

describe('deniesBeingAi', () => {
  it('catches English denials', () => {
    for (const t of ["I'm not a bot", 'I am not an AI, I promise', "No, I'm a real person", 'I am a human, how can I help?', 'This is not a robot call', 'You are talking to a real person', "I'm not an AI assistant"])
      expect(deniesBeingAi(t), t).toBe(true)
  })

  it('catches Hindi and romanized denials', () => {
    for (const t of ['मैं इंसान हूँ', 'मैं असली इंसान हूं', 'मैं बॉट नहीं हूँ', 'मैं AI नहीं हूं', 'main insaan hoon', 'main bot nahi hoon']) expect(deniesBeingAi(t), t).toBe(true)
  })

  it('leaves honest replies alone', () => {
    for (const t of ["I'm Priya, an AI assistant from Jeffi Stores", 'I am an AI, so I cannot see your shop', 'मैं Priya हूँ, Jeffi Stores की AI सहायक', 'Sorry, I am not sure about that price', 'Your site is ready', '']) expect(deniesBeingAi(t), t).toBe(false)
  })
})

describe('quotas', () => {
  it('sendQuota: templates per day and per week', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ day: 5, week: 11 }] })
    expect(await sendQuota('k1', 'template', HARD_LIMITS, NOW)).toBeNull()
    expect(String(h.query.mock.calls[0][0])).toContain('template_slug IS NOT NULL')
    h.query.mockResolvedValueOnce({ rows: [{ day: 6, week: 6 }] })
    expect(await sendQuota('k1', 'template', HARD_LIMITS, NOW)).toBe('template_limit')
    h.query.mockResolvedValueOnce({ rows: [{ day: 1, week: 12 }] })
    expect(await sendQuota('k1', 'template', HARD_LIMITS, NOW)).toBe('template_limit')
  })

  it('sendQuota: texts per day, failed sends not counted', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ day: 19, week: 19 }] })
    expect(await sendQuota('k1', 'text', HARD_LIMITS, NOW)).toBeNull()
    expect(String(h.query.mock.calls[0][0])).toContain('template_slug IS NULL')
    expect(String(h.query.mock.calls[0][0])).toContain(`status IS DISTINCT FROM 'failed'`)
    h.query.mockResolvedValueOnce({ rows: [{ day: 20, week: 20 }] })
    expect(await sendQuota('k1', 'text', HARD_LIMITS, NOW)).toBe('text_limit')
  })

  it('agentCallQuota: total and per IST day', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ total: 2, today: 1 }] })
    expect(await agentCallQuota('k1', HARD_LIMITS, NOW)).toBeNull()
    expect(h.query.mock.calls[0][1]).toEqual(['k1', istDayStart(NOW)])
    h.query.mockResolvedValueOnce({ rows: [{ total: 3, today: 0 }] })
    expect(await agentCallQuota('k1', HARD_LIMITS, NOW)).toBe('call_limit')
    h.query.mockResolvedValueOnce({ rows: [{ total: 2, today: 2 }] })
    expect(await agentCallQuota('k1', HARD_LIMITS, NOW)).toBe('call_limit')
  })

  it('taskQuota: pending tasks', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ n: 2 }] })
    expect(await taskQuota('k1', HARD_LIMITS)).toBeNull()
    h.query.mockResolvedValueOnce({ rows: [{ n: 3 }] })
    expect(await taskQuota('k1', HARD_LIMITS)).toBe('task_limit')
  })

  it('turnBudget: turns, contact spend, program spend, in that order', async () => {
    const q = (turns: number, spend: number, program: number) => h.query.mockResolvedValueOnce({ rows: [{ turns, spend }] }).mockResolvedValueOnce({ rows: [{ spend: program }] })
    q(29, 1999, 49999)
    expect(await turnBudget(contact(), HARD_LIMITS, NOW)).toBeNull()
    q(30, 0, 0)
    expect(await turnBudget(contact(), HARD_LIMITS, NOW)).toBe('turn_limit')
    q(1, 2000, 0)
    expect(await turnBudget(contact(), HARD_LIMITS, NOW)).toBe('spend_limit')
    q(1, 10, 50000)
    expect(await turnBudget(contact(), HARD_LIMITS, NOW)).toBe('program_spend_limit')
  })
})

describe('taskTime', () => {
  it('clamps to at least the minimum lead, refuses beyond the maximum or invalid', () => {
    const min = new Date(NOW.getTime() + 15 * 60_000)
    expect(taskTime(new Date(NOW.getTime() + 60_000), NOW, HARD_LIMITS)).toEqual(min)
    const later = new Date(NOW.getTime() + 3 * 3600_000)
    expect(taskTime(later, NOW, HARD_LIMITS)).toEqual(later)
    expect(taskTime(new Date(NOW.getTime() + 31 * 86_400_000), NOW, HARD_LIMITS)).toBeNull()
    expect(taskTime(new Date('nope'), NOW, HARD_LIMITS)).toBeNull()
  })
})

describe('istDayStart', () => {
  it('is IST midnight', () => {
    expect(istDayStart(NOW).toISOString()).toBe('2026-11-26T18:30:00.000Z')
  })
})
