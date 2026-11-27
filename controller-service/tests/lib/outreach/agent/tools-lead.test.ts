import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn(), transition: vi.fn(), knownBrief: vi.fn(), getShowcaseById: vi.fn() }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/session', () => ({ knownBrief: h.knownBrief, readVoiceSettings: vi.fn() }))
vi.mock('@controller/lib/outreach/whatsapp', () => ({ windowOpen: (c: { wa_window_expires_at?: string | null }) => !!c.wa_window_expires_at }))
vi.mock('@controller/lib/outreach/build', () => ({ OutreachBuildError: class extends Error {} }))
vi.mock('@controller/lib/outreach/state', async orig => ({ ...(await orig<typeof import('@controller/lib/outreach/state')>()), transition: h.transition }))
vi.mock('@/lib/showcase/store', () => ({ getShowcaseById: h.getShowcaseById }))

import { getLead, updateLead, logOutcome, markOutcome, recordConsent } from '@controller/lib/outreach/agent/tools/lead'
import { HARD_LIMITS } from '@controller/lib/outreach/agent/limits'
import { LINES } from '@controller/lib/outreach/prompt'

const NOW = new Date('2026-11-27T06:00:00Z')
const ctx = (o: Record<string, unknown> = {}, contact: Record<string, unknown> = {}) =>
  ({
    channel: 'whatsapp',
    actor: 'outreach:agent',
    contact: { id: 'k1', phone: '+919876543210', business_name: 'Ravi Stores', owner_name: 'Ravi Kumar', category: 'saree shop', city: 'Madurai', language: 'ta', status: 'interested', attempts: 1, consent_whatsapp_at: '2026-11-26T05:00:00Z', opted_out_at: null, handoff_at: null, showcase_site_id: null, wa_window_expires_at: '2026-11-28T00:00:00Z', extra: {}, ...contact },
    call: null,
    run: { id: 'r1' },
    language: 'ta',
    now: NOW,
    limits: HARD_LIMITS,
    scriptVersion: 'demo-skill@v3',
    ...o,
  }) as any
const sqls = () => h.query.mock.calls.map(c => String(c[0]))
const events = () => h.query.mock.calls.filter(c => String(c[0]).startsWith('INSERT INTO outreach_events')).map(c => ({ kind: c[1][2], data: JSON.parse(c[1][3]) }))

beforeEach(() => {
  vi.clearAllMocks()
  h.query.mockResolvedValue({ rows: [], rowCount: 1 })
  h.transition.mockResolvedValue({})
  h.knownBrief.mockResolvedValue({ whatTheyDo: 'sarees' })
  h.getShowcaseById.mockResolvedValue(null)
})

describe('getLead', () => {
  it('returns the lead for the LLM with the phone masked', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ outcome: 'callback', status: 'completed' }] })
    const r = await getLead.run(ctx(), {})
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({
      business: 'Ravi Stores', ownerFirstName: 'Ravi', city: 'Madurai', language: 'ta', status: 'interested', phone: '••••3210',
      consent: { whatsapp: true, at: '2026-11-26T05:00:00Z' }, optedOut: false, handoff: null, attempts: 1, known: { whatTheyDo: 'sarees' },
      site: { started: false, published: false, claimed: false }, whatsappWindowOpen: true, lastCall: { outcome: 'callback', status: 'completed' },
    })
    expect(JSON.stringify(r)).not.toContain('9876543210')
  })

  it('reports a hand-off and an opted-out contact', async () => {
    const r = await getLead.run(ctx({}, { status: 'opted_out', opted_out_at: 'x', handoff_at: 'y', handoff_reason: 'wants a person' }), {})
    expect(r.data).toMatchObject({ optedOut: true, handoff: { at: 'y', reason: 'wants a person' } })
  })
})

describe('updateLead', () => {
  it('updates the given fields only, never status, and records an event', async () => {
    const r = await updateLead.run(ctx(), { owner_name: 'Ravi K', city: 'Chennai' })
    expect(r).toMatchObject({ ok: true, data: { updated: ['owner_name', 'city'] } })
    const up = h.query.mock.calls.find(c => String(c[0]).startsWith('UPDATE outreach_contacts SET owner_name'))!
    expect(String(up[0])).toContain('city = $3')
    expect(String(up[0])).not.toContain('status')
    expect(up[1]).toEqual(['k1', 'Ravi K', 'Chennai'])
    expect(events()).toEqual([{ kind: 'lead_updated', data: { fields: ['owner_name', 'city'] } }])
  })

  it('appends a note to extra.notes, keeping the last 20', async () => {
    const old = Array.from({ length: 20 }, (_, i) => ({ at: 'a', text: `n${i}` }))
    await updateLead.run(ctx({}, { extra: { notes: old } }), { note: 'prefers evenings' })
    const up = h.query.mock.calls.find(c => String(c[0]).includes("jsonb_set(COALESCE(extra"))!
    const notes = JSON.parse(up[1][1])
    expect(notes).toHaveLength(20)
    expect(notes.at(-1)).toEqual({ at: NOW.toISOString(), text: 'prefers evenings' })
    expect(notes[0].text).toBe('n1')
  })

  it('is a no-op without fields', async () => {
    expect((await updateLead.run(ctx(), {})).ok).toBe(true)
    expect(sqls()).toEqual([])
  })
})

describe('logOutcome / markOutcome', () => {
  it('logOutcome writes an agent_note with the run and channel', async () => {
    await logOutcome.run(ctx(), { outcome: 'needs_time', note: 'call next week', tags: ['warm'] })
    expect(events()).toEqual([{ kind: 'agent_note', data: { outcome: 'needs_time', note: 'call next week', tags: ['warm'], channel: 'whatsapp', runId: 'r1' } }])
  })

  it('markOutcome without a call moves the contact and leaves the call table alone', async () => {
    const r = await markOutcome.run(ctx(), { outcome: 'not_interested' })
    expect(r).toMatchObject({ ok: true, say: LINES.ta.notInterested, end: true, data: { outcome: 'not_interested' } })
    expect(sqls().some(s => s.startsWith('UPDATE outreach_calls'))).toBe(false)
    expect(h.transition.mock.calls[0][1]).toBe('not_interested')
  })
})

describe('recordConsent off a call', () => {
  it('cites the skill ref and the channel, uses the last messages as the excerpt, skips the call row', async () => {
    h.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT direction')) return { rows: [{ direction: 'in', template_slug: null, body: 'yes send it', created_at: '2026-11-27T05:59:00Z' }] }
      if (sql.startsWith('SELECT status')) return { rows: [{ status: 'interested' }] }
      return { rows: [], rowCount: 1 }
    })
    const r = await recordConsent.run(ctx(), { whatsapp: true, recording_ack: true, quote: 'yes send it' })
    expect(r).toMatchObject({ ok: true })
    const upd = h.query.mock.calls.find(c => String(c[0]).startsWith('UPDATE outreach_contacts SET consent_whatsapp_at'))!
    const ev = JSON.parse(upd[1][2])
    expect(ev).toMatchObject({ callId: null, channel: 'whatsapp', scriptVersion: 'demo-skill@v3', whatsapp: true, quote: 'yes send it' })
    expect(ev.transcriptExcerpt).toEqual([{ direction: 'in', template: null, at: '2026-11-27T05:59:00.000Z', body: 'yes send it' }])
    expect(sqls().some(s => s.startsWith('UPDATE outreach_calls'))).toBe(false)
    expect(events().map(e => e.kind)).toContain('consent_recorded')
  })
})
