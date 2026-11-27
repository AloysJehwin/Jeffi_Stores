import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn(), transition: vi.fn(), scheduleTask: vi.fn(), handOff: vi.fn(), agentCallQuota: vi.fn(), taskQuota: vi.fn() }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/session', () => ({ knownBrief: vi.fn(), readVoiceSettings: vi.fn() }))
vi.mock('@controller/lib/outreach/build', () => ({ OutreachBuildError: class extends Error {} }))
vi.mock('@controller/lib/outreach/state', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/state')>()), transition: h.transition }))
vi.mock('@controller/lib/outreach/suppress', () => ({ isSuppressed: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/runs', () => ({ scheduleTask: h.scheduleTask, handOff: h.handOff, pendingTaskCount: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/guards', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/agent/guards')>()), agentCallQuota: h.agentCallQuota, taskQuota: h.taskQuota }))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById: vi.fn() }))

import { handOff, optOut, placeCall, scheduleCallback, scheduleFollowUp } from '@controller/lib/outreach/agent/tools/ops'
import { endCall, switchLanguage } from '@controller/lib/outreach/agent/tools/voice'
import { HARD_LIMITS } from '@controller/lib/outreach/agent/limits'
import { LINES } from '@controller/lib/outreach/prompt'

// 11:30 IST
const NOW = new Date('2026-11-27T06:00:00Z')
const ctx = (o: Record<string, unknown> = {}, contact: Record<string, unknown> = {}) =>
  ({
    channel: 'whatsapp', actor: 'outreach:agent',
    contact: { id: 'k1', phone: '+919876543210', status: 'interested', attempts: 1, dnd_status: 'clear', ...contact },
    call: null, run: { id: 'r1' }, language: 'en', now: NOW, limits: HARD_LIMITS, scriptVersion: 'x', ...o,
  }) as any
const voice = (contact: Record<string, unknown> = {}) => ctx({ channel: 'voice', actor: 'voice', call: { id: 'c1', transcript: [] } }, contact)

beforeEach(() => {
  vi.clearAllMocks()
  h.query.mockResolvedValue({ rows: [], rowCount: 1 })
  h.transition.mockResolvedValue({})
  h.agentCallQuota.mockResolvedValue(null)
  h.taskQuota.mockResolvedValue(null)
})

describe('optOut / handOff', () => {
  it('whatsapp optOut applies the opt-out with source whatsapp, touches no call row, sends nothing itself', async () => {
    const r = await optOut.run(ctx(), {})
    expect(r).toEqual({ ok: true, data: { optedOut: true } })
    expect(h.transition.mock.calls[0][1]).toBe('opted_out')
    expect(h.transition.mock.calls[0][2]).toMatchObject({ data: { source: 'whatsapp' }, callId: null })
    const ins = h.query.mock.calls.find(c => String(c[0]).startsWith('INSERT INTO outreach_suppressions'))!
    expect(ins[1]).toEqual(['+919876543210', 'whatsapp_stop', 'whatsapp'])
    expect(h.query.mock.calls.some(c => String(c[0]).startsWith('UPDATE outreach_calls'))).toBe(false)
  })

  it('voice optOut keeps the legacy reply', async () => {
    expect(await optOut.run(voice(), {})).toEqual({ ok: true, say: LINES.en.optedOut, end: true })
    expect(h.query.mock.calls.some(c => String(c[0]).startsWith('UPDATE outreach_calls SET outcome'))).toBe(true)
  })

  it('handOff stops the agent through runs.handOff and ends a call', async () => {
    const r = await handOff.run(ctx(), { reason: 'asks about price' })
    expect(h.handOff).toHaveBeenCalledWith({ contactId: 'k1', reason: 'asks about price', channel: 'whatsapp', actor: 'outreach:agent', now: NOW })
    expect(r).toMatchObject({ ok: true, end: true })
    expect(r.say).toBeUndefined()
  })
})

describe('scheduleCallback', () => {
  it('an engaged contact: quotas, then an agent task of kind call, same spoken line, ends the call', async () => {
    const r = await scheduleCallback.run(voice(), { when: '2026-11-27T17:00:00+05:30' })
    expect(h.agentCallQuota).toHaveBeenCalledWith('k1', HARD_LIMITS, NOW)
    expect(h.taskQuota).toHaveBeenCalledWith('k1', HARD_LIMITS)
    expect(h.scheduleTask).toHaveBeenCalledWith({ runId: 'r1', contactId: 'k1', kind: 'call', dueAt: new Date('2026-11-27T11:30:00Z'), reason: 'callback', createdBy: 'voice' })
    expect(r).toMatchObject({ ok: true, end: true })
    expect(typeof r.say).toBe('string')
    expect(h.transition).not.toHaveBeenCalled()
  })

  it('an engaged contact over a quota or without a run is refused', async () => {
    h.agentCallQuota.mockResolvedValueOnce('call_limit')
    expect(await scheduleCallback.run(voice(), { when: '2026-11-27T17:00:00+05:30' })).toMatchObject({ ok: false, error: 'call_limit', say: LINES.en.callbackCapped, end: true })
    h.taskQuota.mockResolvedValueOnce('task_limit')
    expect(await scheduleCallback.run(ctx(), { when: '2026-11-27T17:00:00+05:30' })).toMatchObject({ ok: false, error: 'task_limit' })
    expect(await scheduleCallback.run(ctx({ run: null }), { when: '2026-11-27T17:00:00+05:30' })).toEqual({ ok: false, error: 'no_run' })
    expect(await scheduleCallback.run(ctx(), { when: 'soonish' })).toMatchObject({ ok: false, error: 'bad_time' })
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })

  it('a contact not yet engaged keeps the dialler path, capped by the skill limit', async () => {
    const lowered = { ...HARD_LIMITS, maxCallAttempts: 1 }
    expect(await scheduleCallback.run({ ...voice({ status: 'calling' }), limits: lowered }, { when: '2026-11-27T17:00:00+05:30' })).toMatchObject({ ok: false, say: LINES.en.callbackCapped, end: true })
    expect(h.transition.mock.calls[0][1]).toBe('failed')
    h.transition.mockClear()
    const r = await scheduleCallback.run(voice({ status: 'calling' }), { when: '2026-11-27T17:00:00+05:30' })
    expect(r).toMatchObject({ ok: true, end: true })
    expect(h.transition.mock.calls[0][1]).toBe('callback')
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })
})

describe('placeCall', () => {
  it('schedules a call task due at the next window time', async () => {
    const r = await placeCall.run(ctx(), {})
    expect(h.scheduleTask).toHaveBeenCalledWith({ runId: 'r1', contactId: 'k1', kind: 'call', dueAt: NOW, reason: 'requested', createdBy: 'outreach:agent' })
    expect(r).toMatchObject({ ok: true, data: { callAt: NOW.toISOString() } })
    // 22:00 IST: held for 09:30 next day
    await placeCall.run(ctx({ now: new Date('2026-11-27T16:30:00Z') }), {})
    expect(h.scheduleTask.mock.calls[1][0].dueAt.toISOString()).toBe('2026-11-28T04:00:00.000Z')
  })

  it('refuses a contact that is not engaged, DND, or over a quota', async () => {
    expect(await placeCall.run(ctx({}, { status: 'calling' }), {})).toMatchObject({ ok: false, error: 'not_engaged' })
    expect(await placeCall.run(ctx({}, { dnd_status: 'dnd' }), {})).toMatchObject({ ok: false, error: 'dnd' })
    h.agentCallQuota.mockResolvedValueOnce('call_limit')
    expect(await placeCall.run(ctx(), {})).toMatchObject({ ok: false, error: 'call_limit' })
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })
})

describe('scheduleFollowUp', () => {
  it('needs exactly one of when / in_hours', () => {
    expect(scheduleFollowUp.args.safeParse({ instruction: 'x' }).success).toBe(false)
    expect(scheduleFollowUp.args.safeParse({ instruction: 'x', in_hours: 2, when: '2026-11-28T10:00:00Z' }).success).toBe(false)
    expect(scheduleFollowUp.args.safeParse({ instruction: 'x', in_hours: 0.1 }).success).toBe(false)
    expect(scheduleFollowUp.args.safeParse({ instruction: 'x', in_hours: 2 }).success).toBe(true)
  })

  it('schedules a whatsapp_turn with the instruction, clamped to the minimum lead', async () => {
    const r = await scheduleFollowUp.run(ctx(), { in_hours: 0.25, instruction: 'ask if the preview looked good', reason: 'nudge' })
    expect(h.scheduleTask).toHaveBeenCalledWith({
      runId: 'r1', contactId: 'k1', kind: 'whatsapp_turn', dueAt: new Date(NOW.getTime() + 15 * 60_000), reason: 'nudge', instruction: 'ask if the preview looked good', createdBy: 'outreach:agent',
    })
    expect(r.ok).toBe(true)
    await scheduleFollowUp.run(ctx(), { when: new Date(NOW.getTime() + 60_000).toISOString(), instruction: 'x' })
    expect(h.scheduleTask.mock.calls[1][0].dueAt).toEqual(new Date(NOW.getTime() + 15 * 60_000))
  })

  it('refuses a time beyond 30 days, a full queue, and a missing run', async () => {
    expect(await scheduleFollowUp.run(ctx(), { when: new Date(NOW.getTime() + 40 * 86_400_000).toISOString(), instruction: 'x' })).toMatchObject({ ok: false, error: 'bad_time' })
    h.taskQuota.mockResolvedValueOnce('task_limit')
    expect(await scheduleFollowUp.run(ctx(), { in_hours: 3, instruction: 'x' })).toMatchObject({ ok: false, error: 'task_limit' })
    expect(await scheduleFollowUp.run(ctx({ run: null }), { in_hours: 3, instruction: 'x' })).toMatchObject({ ok: false, error: 'no_run' })
    expect(h.scheduleTask).not.toHaveBeenCalled()
  })
})

describe('endCall / switchLanguage', () => {
  it('endCall ends without a line; busy and other set the call outcome', async () => {
    expect(await endCall.run(voice(), { outcome: 'done' })).toMatchObject({ ok: true, end: true })
    expect(h.query).not.toHaveBeenCalled()
    const r = await endCall.run(voice(), { outcome: 'busy', note: 'in a meeting' })
    expect(r.say).toBeUndefined()
    expect(h.query.mock.calls[0][1]).toEqual(['c1', 'other', 'in a meeting'])
  })

  it('switchLanguage rings back in the new language', async () => {
    expect(await switchLanguage.run(voice(), { language: 'ta' })).toEqual({ ok: true, say: LINES.ta.switching, redialLanguage: 'ta' })
    expect(await switchLanguage.run(voice(), { language: 'fr' })).toMatchObject({ ok: false })
    expect(await switchLanguage.run(voice(), { language: 'en' })).toEqual({ ok: true, detail: { unchanged: true } })
  })
})
