import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  transition: vi.fn(),
  loadCallContext: vi.fn(),
  startDraft: vi.fn(),
  mergeBrief: vi.fn(),
  requestChange: vi.fn(),
  publish: vi.fn(),
  send: vi.fn(),
}))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/session', () => ({ loadCallContext: h.loadCallContext, readVoiceSettings: vi.fn() }))
vi.mock('@controller/lib/outreach/build.stub', () => ({ startDraft: h.startDraft, mergeBrief: h.mergeBrief, requestChange: h.requestChange, publish: h.publish }))
vi.mock('@controller/lib/outreach/whatsapp', () => ({ sendOutreachTemplate: h.send }))
vi.mock('@controller/lib/outreach/state', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/state')>()), transition: h.transition }))

import { runTool, callbackTime } from '@controller/lib/outreach/tools'
import { InvalidTransitionError } from '@controller/lib/outreach/state'
import { LINES, SCRIPT_VERSION } from '@controller/lib/outreach/prompt'

const CALL = '11111111-1111-4111-8111-111111111111'
// 11:30 IST
const NOW = new Date('2026-11-25T06:00:00Z')
let status = 'calling'

const setup = (contact: Record<string, unknown> = {}, call: Record<string, unknown> = {}) => {
  status = (contact.status as string) ?? 'calling'
  h.loadCallContext.mockResolvedValue({
    call: { id: CALL, contact_id: 'k1', language: 'en', ended_at: null, transcript: [{ role: 'caller', text: 'yes please' }], ...call },
    contact: { id: 'k1', phone: '+919876543210', status, attempts: 1, consent_whatsapp_at: null, language: 'en', program: 'showcase-offer', ...contact },
  })
}
const run = (tool: string, args: unknown = {}) => runTool(CALL, tool, args, NOW)
const events = () =>
  h.query.mock.calls.filter(c => String(c[0]).startsWith('INSERT INTO outreach_events')).map(c => ({ kind: c[1][2], data: JSON.parse(c[1][3]) }))
const sqls = () => h.query.mock.calls.map(c => String(c[0]))
const moves = () => h.transition.mock.calls.map(c => c[1])

beforeEach(() => {
  vi.clearAllMocks()
  h.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT status FROM outreach_contacts')) return { rows: [{ status }] }
    return { rows: [], rowCount: 1 }
  })
  h.transition.mockImplementation(async (_c: unknown, to: string) => {
    status = to
    return {}
  })
  setup()
})

describe('runTool guards', () => {
  it('404s an unknown tool or call, 409s an ended call, 400s bad args', async () => {
    expect((await run('nope')).status).toBe(404)
    h.loadCallContext.mockResolvedValueOnce(null)
    expect((await run('optOut')).status).toBe(404)
    setup({}, { ended_at: '2026-11-25T05:00:00Z' })
    expect((await run('optOut')).status).toBe(409)
    setup()
    const bad = await run('startPreview', { business_name: '' })
    expect(bad.status).toBe(400)
    expect(bad.body.ok).toBe(false)
    expect(events()[0]).toMatchObject({ kind: 'tool_call', data: { tool: 'startPreview', ok: false } })
  })

  it('a thrown action answers ok:false with the apology line and is audited', async () => {
    setup({ consent_whatsapp_at: '2026-11-25T05:59:00Z' })
    h.startDraft.mockRejectedValue(new Error('pipeline down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await run('startPreview', { business_name: 'Ravi Stores' })
    expect(r).toEqual({ status: 200, body: { ok: false, say: LINES.en.failedSoft } })
    expect(events().at(-1)).toMatchObject({ kind: 'tool_call', data: { tool: 'startPreview', ok: false, detail: { error: 'pipeline down' } } })
  })
})

describe('recordConsent', () => {
  it('stores the evidence with the script version and moves the contact to interested', async () => {
    const r = await run('recordConsent', { whatsapp: true, recording_ack: true, quote: 'haan bhejo' })
    expect(r.body).toEqual({ ok: true })
    const upd = h.query.mock.calls.find(c => String(c[0]).startsWith('UPDATE outreach_contacts SET consent_whatsapp_at'))!
    expect(upd[1][3]).toBe(true)
    const evidence = JSON.parse(upd[1][2])
    expect(evidence).toMatchObject({ callId: CALL, scriptVersion: SCRIPT_VERSION, whatsapp: true, recordingAck: true, quote: 'haan bhejo', question: LINES.en.consentAsk })
    expect(evidence.transcriptExcerpt).toEqual([{ role: 'caller', text: 'yes please' }])
    expect(events().map(e => e.kind)).toContain('consent_recorded')
    expect(moves()).toEqual(['interested'])
  })

  it('a no withdraws WhatsApp consent', async () => {
    await run('recordConsent', { whatsapp: false, recording_ack: true })
    const upd = h.query.mock.calls.find(c => String(c[0]).startsWith('UPDATE outreach_contacts SET consent_whatsapp_at'))!
    expect(upd[1][3]).toBe(false)
  })
})

describe('startPreview', () => {
  it('without WhatsApp consent asks for it and builds nothing', async () => {
    const r = await run('startPreview', { business_name: 'Ravi Stores' })
    expect(r.body).toEqual({ ok: false, say: LINES.en.consentNeeded })
    expect(h.startDraft).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('with consent: draft, WhatsApp link, preview_sent, and the success line', async () => {
    setup({ consent_whatsapp_at: '2026-11-25T05:59:00Z' })
    h.startDraft.mockResolvedValue({ siteId: 's1', previewUrl: 'https://site-x/preview?t=abc' })
    h.send.mockResolvedValue({ ok: true, mode: 'captured', messageId: 'm1', providerMessageId: null })
    const r = await run('startPreview', { business_name: 'Ravi Stores' })
    expect(r.body).toEqual({ ok: true, say: LINES.en.previewSent })
    expect(h.startDraft).toHaveBeenCalledWith('k1', { businessName: 'Ravi Stores', language: 'en' })
    expect(h.send).toHaveBeenCalledWith('k1', { template: 'preview_ready', url: 'https://site-x/preview?t=abc', actor: 'voice', callId: CALL })
    expect(moves()).toEqual(['interested', 'building', 'preview_sent'])
    expect(JSON.stringify(events())).not.toContain('t=abc')
  })

  it('does not claim the link went out when WhatsApp fails', async () => {
    setup({ consent_whatsapp_at: '2026-11-25T05:59:00Z' })
    h.startDraft.mockResolvedValue({ siteId: 's1', previewUrl: 'u' })
    h.send.mockResolvedValue({ ok: false, reason: 'failed', error: 'template not approved' })
    const r = await run('startPreview', { business_name: 'Ravi Stores' })
    expect(r.body).toEqual({ ok: false, say: LINES.en.failedSoft })
    expect(moves()).not.toContain('preview_sent')
  })
})

describe('addDetails / requestChange', () => {
  it('merges the brief, moves to building once building, and lets the LLM carry on', async () => {
    setup({ status: 'interested' })
    h.mergeBrief.mockResolvedValue({ building: true, missing: ['hours'] })
    const r = await run('addDetails', { what_they_do: 'sarees', highlights: ['handloom'] })
    expect(r.body).toEqual({ ok: true })
    expect(h.mergeBrief).toHaveBeenCalledWith('k1', { whatTheyDo: 'sarees', highlights: ['handloom'] })
    expect(moves()).toEqual(['building'])
    expect(events().at(-1)!.data).toMatchObject({ tool: 'addDetails', ok: true, args: { what_they_do: 'sarees' } })
  })

  it('an empty addDetails is a no-op', async () => {
    expect((await run('addDetails', {})).body).toEqual({ ok: true })
    expect(h.mergeBrief).not.toHaveBeenCalled()
  })

  it('requestChange speaks done or failed', async () => {
    h.requestChange.mockResolvedValueOnce({ ok: true, summary: 'blue header' })
    expect((await run('requestChange', { instruction: 'make it blue' })).body).toEqual({ ok: true, say: LINES.en.changeDone })
    h.requestChange.mockResolvedValueOnce({ ok: false, summary: '' })
    expect((await run('requestChange', { instruction: 'make it blue' })).body).toEqual({ ok: false, say: LINES.en.changeFailed })
  })
})

describe('publishSite', () => {
  it('needs WhatsApp consent first', async () => {
    expect((await run('publishSite')).body).toEqual({ ok: false, say: LINES.en.publishNeedsConsent })
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('publishes, sends the links, records the outcome', async () => {
    setup({ consent_whatsapp_at: '2026-11-25T05:59:00Z', status: 'preview_sent' })
    h.publish.mockResolvedValue({ liveUrl: 'https://ravi.example', claimUrl: 'https://ecom/claim/x' })
    h.send.mockResolvedValue({ ok: true, mode: 'sent', messageId: 'm', providerMessageId: 'p' })
    expect((await run('publishSite')).body).toEqual({ ok: true, say: LINES.en.published })
    expect(moves()).toEqual(['published'])
    expect(sqls().some(s => s.startsWith('UPDATE outreach_calls SET outcome'))).toBe(true)
    expect(h.send.mock.calls.map(c => [c[1].template, c[1].url])).toEqual([
      ['site_live', 'https://ravi.example'],
      ['claim', 'https://ecom/claim/x'],
    ])
  })

  it('live but links not sent: says so honestly', async () => {
    setup({ consent_whatsapp_at: '2026-11-25T05:59:00Z', status: 'preview_sent' })
    h.publish.mockResolvedValue({ liveUrl: 'l', claimUrl: 'c' })
    h.send.mockResolvedValueOnce({ ok: true, mode: 'sent', messageId: 'm', providerMessageId: 'p' }).mockResolvedValueOnce({ ok: false, reason: 'failed' })
    expect((await run('publishSite')).body).toEqual({ ok: true, say: LINES.en.publishedNoLinks })
  })
})

describe('scheduleCallback', () => {
  it('books inside the calling window and ends the call', async () => {
    const r = await run('scheduleCallback', { when: '2026-11-25T22:00:00+05:30' })
    expect(r.body.ok).toBe(true)
    expect(r.body.end).toBe(true)
    const t = h.transition.mock.calls[0]
    expect(t[1]).toBe('callback')
    // 22:00 IST is outside the window: the next day at 09:30 IST
    expect(t[2].set.next_attempt_at.toISOString()).toBe('2026-11-26T04:00:00.000Z')
  })

  it('asks again for an unreadable time, and refuses past the attempt cap', async () => {
    expect((await run('scheduleCallback', { when: 'tomorrow-ish' })).body).toEqual({ ok: false, say: LINES.en.callbackAskTime })
    setup({ attempts: 3 })
    expect((await run('scheduleCallback', { when: '2026-11-25T17:00:00+05:30' })).body).toEqual({ ok: false, say: LINES.en.callbackCapped, end: true })
    expect(moves()).toEqual(['failed'])
  })

  it('callbackTime: at least 15 minutes out, never past 30 days', () => {
    expect(callbackTime('2026-11-25T06:01:00Z', NOW)!.toISOString()).toBe('2026-11-25T06:15:00.000Z')
    expect(callbackTime('2027-02-01T10:00:00+05:30', NOW)).toBeNull()
  })
})

describe('markOutcome / optOut / switchLanguage', () => {
  it('markOutcome moves the contact and ends politely', async () => {
    expect((await run('markOutcome', { outcome: 'wrong_number' })).body).toEqual({ ok: true, say: LINES.en.wrongNumber, end: true })
    expect(moves()).toEqual(['wrong_number'])
    expect((await run('markOutcome', { outcome: 'other', note: 'shop closed' })).body).toEqual({ ok: true, say: LINES.en.notInterested, end: true })
  })

  it('markOutcome tolerates a contact that already moved on', async () => {
    h.transition.mockRejectedValueOnce(new InvalidTransitionError('building', 'not_interested'))
    expect((await run('markOutcome', { outcome: 'not_interested' })).body.ok).toBe(true)
  })

  it('optOut: opted_out, suppression list, other contacts suppressed, call ends', async () => {
    h.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id FROM outreach_contacts WHERE phone')) return { rows: [{ id: 'k2' }] }
      return { rows: [], rowCount: 1 }
    })
    expect((await run('optOut')).body).toEqual({ ok: true, say: LINES.en.optedOut, end: true })
    expect(h.transition.mock.calls.map(c => [c[0].id, c[1]])).toEqual([
      ['k1', 'opted_out'],
      ['k2', 'suppressed'],
    ])
    const ins = h.query.mock.calls.find(c => String(c[0]).startsWith('INSERT INTO outreach_suppressions'))!
    expect(ins[1][0]).toBe('+919876543210')
    expect(events().map(e => e.kind)).toContain('suppression_added')
  })

  it('optOut still hangs up when the database fails', async () => {
    h.query.mockRejectedValueOnce(new Error('db down'))
    const r = await run('optOut')
    expect(r.body).toEqual({ ok: false, say: LINES.en.optedOut, end: true })
  })

  it('switchLanguage rings back in the new language', async () => {
    const r = await run('switchLanguage', { language: 'ta' })
    expect(r.body).toEqual({ ok: true, say: LINES.ta.switching, redialLanguage: 'ta' })
    expect(h.query.mock.calls.some(c => String(c[0]).startsWith('UPDATE outreach_contacts SET language') && c[1][1] === 'ta')).toBe(true)
    expect((await run('switchLanguage', { language: 'fr' })).body.ok).toBe(false)
    expect((await run('switchLanguage', { language: 'en' })).body).toEqual({ ok: true })
  })
})
