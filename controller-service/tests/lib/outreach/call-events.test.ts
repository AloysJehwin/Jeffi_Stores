import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  retryOrFail: vi.fn(),
  redialContact: vi.fn(),
  applyOptOut: vi.fn(),
  readVoiceSettings: vi.fn(),
  getProgramState: vi.fn(),
  presign: vi.fn(),
  onCallEnded: vi.fn(),
}))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/worker', async orig => ({
  ...(await orig<typeof import('@controller/lib/outreach/worker')>()),
  retryOrFail: h.retryOrFail,
  redialContact: h.redialContact,
}))
vi.mock('@controller/lib/outreach/tools', () => ({ applyOptOut: h.applyOptOut }))
vi.mock('@controller/lib/outreach/agent/runtime', () => ({ onCallEnded: h.onCallEnded }))
vi.mock('@controller/lib/outreach/session', () => ({ readVoiceSettings: h.readVoiceSettings, loadCallContext: vi.fn() }))
vi.mock('@controller/lib/outreach/program-state', () => ({ getProgramState: h.getProgramState, WINDOW_MIN: '09:30', WINDOW_MAX: '20:30' }))
vi.mock('@/lib/shared/s3', () => ({ presignPlatformObjectGet: h.presign }))

import { handleCallEvent, normalizeTurns, recordingUrl, getCallDetail } from '@controller/lib/outreach/call-events'

const CALL = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-25T06:00:00Z')
let callRow: Record<string, unknown> | null
let terminalRow: Record<string, unknown> | null
let contact: Record<string, unknown>
let suppressed = false
let redials = 0

const ev = (type: string, data: Record<string, unknown> = {}) => handleCallEvent(CALL, { type, at: '2026-11-25T05:59:30Z', data }, NOW)
const sqlCalls = (prefix: string) => h.query.mock.calls.filter(c => String(c[0]).trimStart().startsWith(prefix))
const eventKinds = () => sqlCalls('INSERT INTO outreach_events').map(c => c[1][2])

beforeEach(() => {
  vi.clearAllMocks()
  callRow = { id: CALL, contact_id: 'k1', ended_at: null }
  terminalRow = { id: CALL, contact_id: 'k1', outcome: null, recording_key: 'outreach/recordings/x.mp3' }
  contact = { id: 'k1', phone: '+919876543210', status: 'calling', attempts: 1, last_call_id: CALL, program: 'showcase-offer', opted_out_at: null }
  suppressed = false
  redials = 0
  h.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT id, contact_id, ended_at FROM outreach_calls')) return { rows: callRow ? [callRow] : [] }
    if (sql.startsWith('UPDATE outreach_calls SET status = $2')) return { rows: terminalRow ? [terminalRow] : [] }
    if (sql.startsWith('SELECT * FROM outreach_contacts')) return { rows: [contact] }
    if (sql.startsWith('SELECT 1 FROM outreach_suppressions')) return { rows: suppressed ? [{}] : [] }
    if (sql.includes("kind = 'redial'")) return { rows: [{ n: redials }] }
    return { rows: [], rowCount: 1 }
  })
  h.getProgramState.mockResolvedValue({ window_start: '09:30', window_end: '20:30', test_numbers: [] })
  h.readVoiceSettings.mockResolvedValue({ provider: 'exotel', settings: { exotel: { callerId: '+911400000000' }, twilioTest: { from: '' } } })
  h.redialContact.mockResolvedValue({ callId: 'c2', providerCallId: 'p2' })
})

describe('normalizeTurns', () => {
  it("maps voice-service roles to agent / caller and drops junk", () => {
    expect(
      normalizeTurns([
        { role: 'agent', text: ' Hello ', at: '2026-11-25T05:59:00Z' },
        { role: 'user', text: 'haan' },
        { speaker: 'assistant', content: 'ok' },
        { role: 'system', text: 'x' },
        { role: 'user', text: '   ' },
        'nope',
      ])
    ).toEqual([
      { role: 'agent', text: 'Hello', at: '2026-11-25T05:59:00Z' },
      { role: 'caller', text: 'haan' },
      { role: 'agent', text: 'ok' },
    ])
    expect(normalizeTurns(null)).toEqual([])
  })
})

describe('handleCallEvent', () => {
  it('400s an unknown type, 404s an unknown call', async () => {
    expect((await ev('exploded')).status).toBe(400)
    callRow = null
    expect((await ev('ringing')).status).toBe(404)
  })

  it('ringing and answered move the call row and are audited', async () => {
    expect((await ev('ringing', { provider: 'exotel', providerCallId: 'p1' })).status).toBe(200)
    const ring = sqlCalls('UPDATE outreach_calls SET status = CASE WHEN status = \'queued\'')[0]
    expect(ring[1].slice(0, 3)).toEqual([CALL, 'exotel', 'p1'])
    await ev('answered')
    expect(sqlCalls("UPDATE outreach_calls SET status = CASE WHEN status IN").length).toBe(1)
    expect(eventKinds()).toEqual(['call_ringing', 'call_answered'])
  })

  it('appends normalized transcript batches without an audit row per batch', async () => {
    const r = await ev('transcript', { turns: [{ role: 'user', text: 'hello', at: 'x' }, { role: 'agent', text: 'hi' }] })
    expect(r.body).toEqual({ ok: true, turns: 2 })
    const upd = sqlCalls('UPDATE outreach_calls SET transcript')[0]
    expect(JSON.parse(upd[1][1])).toEqual([{ role: 'caller', text: 'hello', at: 'x' }, { role: 'agent', text: 'hi' }])
    expect(eventKinds()).toEqual([])
  })

  it('no_answer: closes the call and puts a calling contact on the retry path', async () => {
    expect((await ev('no_answer', { reason: 'no_answer', terminal: true })).body).toEqual({ ok: true })
    const upd = sqlCalls('UPDATE outreach_calls SET status = $2')[0]
    expect(upd[1][1]).toBe('no_answer')
    expect(h.retryOrFail).toHaveBeenCalledWith(contact, NOW, expect.objectContaining({ reason: 'no_answer', callId: CALL }))
    expect(eventKinds()).toContain('call_no_answer')
  })

  it('ended stores duration, transcript and recording; an empty-handed call is incomplete', async () => {
    await ev('ended', { durationS: 42, durationSource: 'provider', recordingKey: 'outreach/recordings/x.mp3', transcript: [{ role: 'agent', text: 'Hello' }], terminal: true })
    const upd = sqlCalls('UPDATE outreach_calls SET status = $2')[0]
    expect(upd[1][1]).toBe('completed')
    expect(upd[1][3]).toBe(42)
    expect(JSON.parse(upd[1][4])).toEqual([{ role: 'agent', text: 'Hello' }])
    expect(upd[1][5]).toBe('outreach/recordings/x.mp3')
    expect(sqlCalls('UPDATE outreach_calls SET outcome = COALESCE(outcome, $2)')[0][1]).toEqual([CALL, 'incomplete'])
    expect(h.retryOrFail).toHaveBeenCalled()
  })

  it('error records the reason as the call error', async () => {
    await ev('error', { reason: 'restart', terminal: true })
    const upd = sqlCalls('UPDATE outreach_calls SET status = $2')[0]
    expect(upd[1][1]).toBe('failed')
    expect(upd[1][6]).toBe('restart')
  })

  it('a repeated terminal event is acknowledged and ignored', async () => {
    terminalRow = null
    expect((await ev('ended', { durationS: 1 })).body).toEqual({ ok: true, duplicate: true })
    expect(h.retryOrFail).not.toHaveBeenCalled()
  })

  it('an engaged contact keeps its status; the call outcome follows it', async () => {
    contact.status = 'preview_sent'
    await ev('ended', { durationS: 300 })
    expect(h.retryOrFail).not.toHaveBeenCalled()
    expect(sqlCalls('UPDATE outreach_calls SET outcome = COALESCE(outcome, $2)')[0][1]).toEqual([CALL, 'interested'])
  })

  it('only the latest call moves the contact', async () => {
    contact.last_call_id = 'another'
    await ev('busy', { reason: 'busy' })
    expect(h.retryOrFail).not.toHaveBeenCalled()
  })

  it('re-applies an opt-out the tool could not finish', async () => {
    terminalRow = { ...terminalRow, outcome: 'opted_out' }
    await ev('ended', { durationS: 20 })
    expect(h.applyOptOut).toHaveBeenCalledWith(contact, CALL, NOW)
    expect(h.retryOrFail).not.toHaveBeenCalled()
  })

  it('ended with redialLanguage rings back in that language', async () => {
    await ev('ended', { durationS: 30, redialLanguage: 'ta' })
    expect(h.redialContact).toHaveBeenCalledWith(contact, expect.objectContaining({ language: 'ta', fromCallId: CALL, from: '+911400000000', provider: 'exotel' }))
    expect(h.retryOrFail).not.toHaveBeenCalled()
  })

  it('no redial when suppressed, outside the window or redialled too often: back to the retry path', async () => {
    suppressed = true
    await ev('ended', { redialLanguage: 'ta' })
    expect(h.redialContact).not.toHaveBeenCalled()
    expect(h.retryOrFail).toHaveBeenCalledTimes(1)

    suppressed = false
    redials = 2
    await ev('ended', { redialLanguage: 'ta' })
    expect(h.redialContact).not.toHaveBeenCalled()

    redials = 0
    await handleCallEvent(CALL, { type: 'ended', data: { redialLanguage: 'ta' } }, new Date('2026-11-25T16:00:00Z'))
    expect(h.redialContact).not.toHaveBeenCalled()
  })
})

describe('the agent follow-up after a terminal event', () => {
  it('asks the runtime once the contact has been settled, with the event type', async () => {
    contact.status = 'preview_sent'
    await ev('ended', { durationS: 300 })
    expect(h.onCallEnded).toHaveBeenCalledWith(CALL, 'ended', NOW)
    h.onCallEnded.mockClear()
    await ev('no_answer', { reason: 'no_answer' })
    expect(h.onCallEnded).toHaveBeenCalledWith(CALL, 'no_answer', NOW)
  })

  it('does not follow up a duplicate terminal event, nor a ring-back in another language', async () => {
    terminalRow = null
    await ev('ended', { durationS: 1 })
    expect(h.onCallEnded).not.toHaveBeenCalled()
    terminalRow = { id: CALL, contact_id: 'k1', outcome: null, recording_key: null }
    await ev('ended', { durationS: 30, redialLanguage: 'ta' })
    expect(h.redialContact).toHaveBeenCalled()
    expect(h.onCallEnded).not.toHaveBeenCalled()
  })

  it('a failing follow-up never breaks the events route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.onCallEnded.mockRejectedValueOnce(new Error('boom'))
    expect((await ev('ended', { durationS: 5 })).status).toBe(200)
  })
})

describe('recordings and the admin detail', () => {
  it('signs only outreach recording keys', async () => {
    h.presign.mockResolvedValue('https://signed')
    expect(await recordingUrl('outreach/recordings/11111111-1111-4111-8111-111111111111.mp3')).toBe('https://signed')
    expect(await recordingUrl('prod/outreach/recordings/11111111-1111-4111-8111-111111111111.mp3')).toBe('https://signed')
    expect(await recordingUrl('invoices/secret.pdf')).toBeNull()
    expect(await recordingUrl(null)).toBeNull()
    h.presign.mockRejectedValueOnce(new Error('no creds'))
    expect(await recordingUrl('outreach/recordings/11111111-1111-4111-8111-111111111111.mp3')).toBeNull()
  })

  it('getCallDetail returns { call, recordingUrl, events } without provider internals', async () => {
    h.presign.mockResolvedValue('https://signed')
    h.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM outreach_calls')) {
        return {
          rows: [
            {
              id: CALL,
              contact_id: 'k1',
              provider_call_id: 'secret-provider-id',
              recording_key: `outreach/recordings/${CALL}.mp3`,
              transcript: [{ role: 'user', text: 'hi' }],
              consent: { whatsapp: true },
            },
          ],
        }
      }
      if (sql.startsWith('SELECT * FROM outreach_events')) return { rows: [{ id: 1, kind: 'call_ringing' }] }
      return { rows: [] }
    })
    const d = await getCallDetail(CALL)
    expect(Object.keys(d!).sort()).toEqual(['call', 'events', 'recordingUrl'])
    expect(d!.recordingUrl).toBe('https://signed')
    expect(d!.call).not.toHaveProperty('provider_call_id')
    expect(d!.call).not.toHaveProperty('recording_key')
    expect(d!.call.transcript).toEqual([{ role: 'caller', text: 'hi' }])
    expect(d!.call.consent).toEqual({ whatsapp: true })
    expect(d!.events).toEqual([{ id: 1, kind: 'call_ringing' }])
  })

  it('getCallDetail is null for an unknown call', async () => {
    h.query.mockResolvedValue({ rows: [] })
    expect(await getCallDetail(CALL)).toBeNull()
  })
})
