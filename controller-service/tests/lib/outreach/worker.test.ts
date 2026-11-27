import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  transition: vi.fn(),
  placeCall: vi.fn(),
  getProgramState: vi.fn(),
  readVoiceSettings: vi.fn(),
  planFirstTouch: vi.fn(),
}))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/state', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/state')>()), transition: h.transition }))
vi.mock('@controller/lib/outreach/program-state', () => ({ getProgramState: h.getProgramState, WINDOW_MIN: '09:30', WINDOW_MAX: '20:30' }))
vi.mock('@controller/lib/outreach/session', () => ({ readVoiceSettings: h.readVoiceSettings }))
vi.mock('@controller/lib/outreach/agent/runtime', () => ({ planFirstTouch: h.planFirstTouch }))
vi.mock('@controller/lib/outreach/voice-client', async orig => ({
  ...(await orig<typeof import('@controller/lib/outreach/voice-client')>()),
  placeCall: h.placeCall,
}))

import {
  inCallingWindow,
  nextWindowTime,
  istMidnight,
  retryOrFail,
  runOutreachWorker,
  sweepStaleCalls,
  dialContact,
  callCounts,
  startTestCall,
  TestCallError,
} from '@controller/lib/outreach/worker'
import { InvalidTransitionError } from '@controller/lib/outreach/state'
import { VoiceServiceError } from '@controller/lib/outreach/voice-client'

const at = (istHHMM: string, day = '2026-11-25') => new Date(`${day}T${istHHMM}:00+05:30`)
const NOW = at('11:30')
const contact = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  phone: '+919876543210',
  status: 'queued',
  attempts: 0,
  language: 'hi',
  opted_out_at: null,
  last_call_id: null,
  source: 'upload',
  ...over,
})
const state = (over: Record<string, unknown> = {}) => ({
  program: 'showcase-offer',
  enabled: true,
  daily_cap: 50,
  concurrency: 2,
  window_start: '09:30',
  window_end: '20:30',
  test_numbers: [],
  ...over,
})

let due: unknown[]
let counts: { today: number; active: number }
const sql = (prefix: string) => h.query.mock.calls.filter(c => String(c[0]).trimStart().startsWith(prefix))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VOICE_SERVICE_URL', 'http://voice:8080')
  due = [contact()]
  counts = { today: 0, active: 0 }
  h.query.mockImplementation(async (s: string) => {
    if (s.includes('count(*) FILTER')) return { rows: [counts] }
    if (s.startsWith('SELECT c.* FROM outreach_contacts c')) return { rows: due }
    if (s.startsWith('UPDATE outreach_calls SET status = \'failed\', ended_at = $1')) return { rows: [] }
    return { rows: [], rowCount: 1 }
  })
  h.transition.mockResolvedValue({})
  h.planFirstTouch.mockResolvedValue('call')
  h.placeCall.mockResolvedValue({ providerCallId: 'p1', duplicate: false })
  h.getProgramState.mockResolvedValue(state())
  h.readVoiceSettings.mockResolvedValue({ provider: 'exotel', settings: { exotel: { callerId: '+911400000000' }, twilioTest: { from: '+15550001111' } } })
})
afterEach(() => vi.unstubAllEnvs())

describe('calling window (IST)', () => {
  it('is 09:30 to 20:30, clipped to the program window', () => {
    expect(inCallingWindow(at('09:29'))).toBe(false)
    expect(inCallingWindow(at('09:30'))).toBe(true)
    expect(inCallingWindow(at('20:29'))).toBe(true)
    expect(inCallingWindow(at('20:30'))).toBe(false)
    expect(inCallingWindow(at('11:00'), { window_start: '12:00', window_end: '18:00' })).toBe(false)
    // a program window wider than the compliance bounds is clipped
    expect(inCallingWindow(at('08:00'), { window_start: '07:00', window_end: '22:00' })).toBe(false)
    expect(inCallingWindow(at('21:00'), { window_start: '07:00', window_end: '22:00' })).toBe(false)
  })

  it('nextWindowTime moves early times to 09:30 today and late ones to 09:30 tomorrow', () => {
    expect(nextWindowTime(at('11:00')).toISOString()).toBe(at('11:00').toISOString())
    expect(nextWindowTime(at('07:00')).toISOString()).toBe(at('09:30').toISOString())
    expect(nextWindowTime(at('22:00')).toISOString()).toBe(at('09:30', '2026-11-26').toISOString())
    expect(nextWindowTime(at('01:00', '2026-11-26')).toISOString()).toBe(at('09:30', '2026-11-26').toISOString())
    expect(istMidnight(at('01:00', '2026-11-26')).toISOString()).toBe('2026-11-25T18:30:00.000Z')
  })
})

describe('retryOrFail', () => {
  it('no_answer with the next try 4h out (inside the window), failed after the third attempt', async () => {
    expect(await retryOrFail({ id: 'k1', attempts: 1 }, NOW, { actor: 'voice', reason: 'busy' })).toBe('no_answer')
    expect(h.transition.mock.calls[0][1]).toBe('no_answer')
    expect(h.transition.mock.calls[0][2].set.next_attempt_at.toISOString()).toBe(at('15:30').toISOString())
    // 18:00 + 4h = 22:00, outside: next morning
    await retryOrFail({ id: 'k1', attempts: 2 }, at('18:00'), { actor: 'voice', reason: 'no_answer' })
    expect(h.transition.mock.calls[1][2].set.next_attempt_at.toISOString()).toBe(at('09:30', '2026-11-26').toISOString())
    expect(await retryOrFail({ id: 'k1', attempts: 3 }, NOW, { actor: 'voice', reason: 'no_answer' })).toBe('failed')
    expect(h.transition.mock.calls[2][1]).toBe('failed')
  })

  it('ignores a contact that already moved on', async () => {
    h.transition.mockRejectedValueOnce(new InvalidTransitionError('opted_out', 'no_answer'))
    expect(await retryOrFail({ id: 'k1', attempts: 1 }, NOW, { actor: 'voice', reason: 'x' })).toBeNull()
  })
})

describe('dialContact', () => {
  it('inserts the call, moves the contact to calling (one more attempt) and asks voice-service to dial', async () => {
    const r = await dialContact(contact({ attempts: 1 }) as any, { language: 'hi', actor: 'worker', from: '+911400000000', provider: 'exotel' })
    expect(r.providerCallId).toBe('p1')
    const ins = sql('INSERT INTO outreach_calls')[0]
    expect(ins[1][0]).toBe(r.callId)
    expect(h.transition).toHaveBeenCalledWith(expect.objectContaining({ id: 'k1' }), 'calling', expect.objectContaining({ set: expect.objectContaining({ attempts: 2, last_call_id: r.callId }) }))
    expect(h.placeCall).toHaveBeenCalledWith({ callId: r.callId, to: '+919876543210', from: '+911400000000', language: 'hi' })
  })

  it('a refused dial is not an attempt: call failed, contact back to queued', async () => {
    h.placeCall.mockRejectedValue(new VoiceServiceError('at capacity', 429))
    await expect(dialContact(contact({ attempts: 1 }) as any, { language: 'en', actor: 'worker', from: '', provider: 'exotel' })).rejects.toThrow('at capacity')
    expect(sql("UPDATE outreach_calls SET status = 'failed'")[0][1][1]).toContain('dial_failed')
    expect(h.transition.mock.calls[1][1]).toBe('queued')
    expect(h.transition.mock.calls[1][2].set.attempts).toBe(1)
  })

  it('an unanswered request leaves the call to its events or the stale sweep', async () => {
    h.placeCall.mockRejectedValue(new VoiceServiceError('voice-service unreachable', 0))
    await expect(dialContact(contact() as any, { language: 'en', actor: 'worker', from: '', provider: 'exotel' })).rejects.toThrow()
    expect(sql("UPDATE outreach_calls SET status = 'failed'")).toHaveLength(0)
    expect(h.transition).toHaveBeenCalledTimes(1)
  })

  it('drops the call row when the contact cannot move to calling', async () => {
    h.transition.mockRejectedValueOnce(new InvalidTransitionError('opted_out', 'calling'))
    await expect(dialContact(contact() as any, { language: 'en', actor: 'worker', from: '', provider: 'exotel' })).rejects.toBeInstanceOf(InvalidTransitionError)
    expect(sql('DELETE FROM outreach_calls')).toHaveLength(1)
    expect(h.placeCall).not.toHaveBeenCalled()
  })
})

describe('sweepStaleCalls', () => {
  it('fails calls with no terminal event and retries their calling contact', async () => {
    h.query.mockImplementation(async (s: string) => {
      if (s.startsWith("UPDATE outreach_calls SET status = 'failed', ended_at = $1")) return { rows: [{ id: 'c1', contact_id: 'k1' }] }
      if (s.startsWith('SELECT id, status, attempts, last_call_id')) return { rows: [{ id: 'k1', status: 'calling', attempts: 1, last_call_id: 'c1' }] }
      return { rows: [] }
    })
    expect(await sweepStaleCalls(NOW)).toBe(1)
    expect(h.transition.mock.calls[0][1]).toBe('no_answer')
  })
})

describe('runOutreachWorker', () => {
  it('dials due contacts inside the window, within caps', async () => {
    counts = { today: 10, active: 1 }
    const r = await runOutreachWorker(NOW)
    expect(r.programs).toEqual([{ program: 'showcase-offer', placed: 1, failed: 0 }])
    const pick = sql('SELECT c.* FROM outreach_contacts c')[0]
    // limit = min(daily_cap - today, concurrency - active); not test mode → no number list (DND must be clear)
    expect(pick[1]).toEqual(['showcase-offer', NOW, 3, 1, null])
    expect(String(pick[0])).toContain("c.dnd_status = 'clear'")
    expect(String(pick[0])).toContain('outreach_suppressions')
    expect(h.placeCall).toHaveBeenCalledWith(expect.objectContaining({ from: '+911400000000', language: 'hi' }))
  })

  it('skips when disabled, outside the window, or out of cap / concurrency', async () => {
    h.getProgramState.mockResolvedValueOnce(state({ enabled: false }))
    expect((await runOutreachWorker(NOW)).programs[0].skipped).toBe('disabled')
    expect((await runOutreachWorker(at('21:00'))).programs[0].skipped).toBe('outside_window')
    counts = { today: 50, active: 0 }
    expect((await runOutreachWorker(NOW)).programs[0].skipped).toBe('daily_cap')
    counts = { today: 0, active: 2 }
    expect((await runOutreachWorker(NOW)).programs[0].skipped).toBe('concurrency')
    expect(h.placeCall).not.toHaveBeenCalled()
  })

  it('test mode (twilio_test) dials only the test numbers, and nobody without any', async () => {
    h.readVoiceSettings.mockResolvedValue({ provider: 'twilio_test', settings: { exotel: { callerId: '' }, twilioTest: { from: '+15550001111' } } })
    expect((await runOutreachWorker(NOW)).programs[0].skipped).toBe('test_mode_without_numbers')
    h.getProgramState.mockResolvedValue(state({ test_numbers: ['+919876543210'] }))
    const r = await runOutreachWorker(NOW)
    expect(r.testMode).toBe(true)
    expect(sql('SELECT c.* FROM outreach_contacts c')[0][1][4]).toEqual(['+919876543210'])
    expect(h.placeCall).toHaveBeenCalledWith(expect.objectContaining({ from: '+15550001111' }))
  })

  it('stops the run when voice-service is not configured or full', async () => {
    due = [contact(), contact({ id: 'k2', phone: '+919876543211' })]
    h.placeCall.mockRejectedValue(new VoiceServiceError('not configured', 503))
    const r = await runOutreachWorker(NOW)
    expect(r.programs[0]).toMatchObject({ placed: 0, failed: 1 })
    expect(h.placeCall).toHaveBeenCalledTimes(1)
  })

  it("asks the contact's skill before dialling: only 'call' rings", async () => {
    due = [contact(), contact({ id: 'k2', phone: '+919876543211' }), contact({ id: 'k3', phone: '+919876543212' })]
    h.planFirstTouch.mockResolvedValueOnce('whatsapp').mockResolvedValueOnce('skip').mockResolvedValueOnce('call')
    counts = { today: 0, active: 0 }
    const r = await runOutreachWorker(NOW)
    expect(h.planFirstTouch).toHaveBeenCalledTimes(3)
    expect(h.planFirstTouch.mock.calls[0]).toEqual([due[0], NOW])
    expect(h.placeCall).toHaveBeenCalledTimes(1)
    expect(h.placeCall).toHaveBeenCalledWith(expect.objectContaining({ to: '+919876543212' }))
    expect(r.programs[0]).toMatchObject({ placed: 1, failed: 0 })
  })

  it('a contact whose first-touch plan fails is not dialled and the run goes on', async () => {
    due = [contact(), contact({ id: 'k2', phone: '+919876543211' })]
    h.planFirstTouch.mockRejectedValueOnce(new Error('skill store down'))
    const r = await runOutreachWorker(NOW)
    expect(r.programs[0]).toMatchObject({ placed: 1, failed: 1 })
    expect(h.placeCall).toHaveBeenCalledTimes(1)
  })

  it('without VOICE_SERVICE_URL only sweeps', async () => {
    vi.stubEnv('VOICE_SERVICE_URL', '')
    expect(await runOutreachWorker(NOW)).toEqual({ swept: 0, skipped: 'not_configured', programs: [] })
    expect(h.getProgramState).not.toHaveBeenCalled()
  })
})

describe('callCounts', () => {
  it('counts the program calls placed today (dial failures excluded) and those still open', async () => {
    counts = { today: 4, active: 1 }
    expect(await callCounts('showcase-offer', NOW)).toEqual({ today: 4, active: 1 })
    expect(sql('SELECT count(*) FILTER')[0][1]).toEqual(['showcase-offer', istMidnight(NOW)])
  })
})

describe('startTestCall', () => {
  const upsert = (row: Record<string, unknown>) =>
    h.query.mockImplementation(async (s: string) => {
      if (s.startsWith('INSERT INTO outreach_contacts')) return { rows: [row] }
      if (s.startsWith('UPDATE outreach_contacts SET status = \'queued\'')) return { rows: [{ ...row, status: 'queued', attempts: 0 }] }
      if (s.startsWith('SELECT 1 FROM outreach_suppressions')) return { rows: [] }
      if (s.startsWith('SELECT 1 FROM outreach_calls')) return { rows: [] }
      return { rows: [], rowCount: 1 }
    })

  it('refuses a number that is not a test number', async () => {
    await expect(startTestCall({ phone: '+919876543210', language: 'en', program: 'showcase-offer' }, 'admin:a1')).rejects.toMatchObject({ status: 403 })
  })

  it('only the first 10 test numbers count', async () => {
    const nums = Array.from({ length: 11 }, (_, i) => `+9198765432${String(i).padStart(2, '0')}`)
    h.getProgramState.mockResolvedValue(state({ test_numbers: nums }))
    await expect(startTestCall({ phone: nums[10], language: 'en', program: 'showcase-offer' }, 'a')).rejects.toBeInstanceOf(TestCallError)
  })

  it('creates or resets the test contact and dials it', async () => {
    h.getProgramState.mockResolvedValue(state({ test_numbers: ['+919876543210'] }))
    upsert(contact({ status: 'published', attempts: 2, source: 'test_call' }))
    const r = await startTestCall({ phone: '+919876543210', language: 'ta', program: 'showcase-offer' }, 'admin:a1')
    expect(r.callId).toMatch(/^[0-9a-f-]{36}$/)
    expect(sql("UPDATE outreach_contacts SET status = 'queued'")).toHaveLength(1)
    expect(h.placeCall).toHaveBeenCalledWith(expect.objectContaining({ to: '+919876543210', language: 'ta' }))
  })

  it('refuses a suppressed number and a call already in progress', async () => {
    h.getProgramState.mockResolvedValue(state({ test_numbers: ['+919876543210'] }))
    h.query.mockImplementation(async (s: string) => (s.startsWith('SELECT 1 FROM outreach_suppressions') ? { rows: [{}] } : { rows: [] }))
    await expect(startTestCall({ phone: '+919876543210', language: 'en', program: 'showcase-offer' }, 'a')).rejects.toMatchObject({ status: 409 })
    h.query.mockImplementation(async (s: string) => {
      if (s.startsWith('INSERT INTO outreach_contacts')) return { rows: [contact({ last_call_id: 'c0', source: 'test_call' })] }
      if (s.startsWith('SELECT 1 FROM outreach_calls')) return { rows: [{}] }
      return { rows: [] }
    })
    await expect(startTestCall({ phone: '+919876543210', language: 'en', program: 'showcase-offer' }, 'a')).rejects.toMatchObject({ status: 409 })
  })

  it('reports a refused dial as 502 with the call id', async () => {
    h.getProgramState.mockResolvedValue(state({ test_numbers: ['+919876543210'] }))
    upsert(contact({ source: 'test_call' }))
    h.placeCall.mockRejectedValue(new VoiceServiceError('twilio refused', 403))
    await expect(startTestCall({ phone: '+919876543210', language: 'en', program: 'showcase-offer' }, 'a')).rejects.toMatchObject({ status: 502 })
  })
})
