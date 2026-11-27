import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))

import { hadAnsweredCall, knownBrief, loadCallContext, readVoiceSettings } from '@controller/lib/outreach/session'

// The session itself (buildVoiceSession) is tested with the runtime: tests/lib/outreach/agent/runtime.test.ts.

let settings: { key: string; value: unknown }[]
let briefRows: unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  settings = []
  briefRows = []
  h.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT key, value FROM platform_provider_settings')) return { rows: settings }
    if (sql.startsWith('SELECT data FROM outreach_events')) return { rows: briefRows }
    if (sql.startsWith('SELECT * FROM outreach_calls')) return { rows: [{ id: 'c1', contact_id: 'k1' }] }
    if (sql.startsWith('SELECT * FROM outreach_contacts')) return { rows: [{ id: 'k1' }] }
    if (sql.startsWith('SELECT 1 FROM outreach_calls')) return { rows: [{}] }
    return { rows: [] }
  })
})

describe('loadCallContext', () => {
  it('returns the call with its contact, null when either is missing', async () => {
    expect(await loadCallContext('c1')).toEqual({ call: { id: 'c1', contact_id: 'k1' }, contact: { id: 'k1' } })
    h.query.mockResolvedValue({ rows: [] })
    expect(await loadCallContext('c1')).toBeNull()
  })
})

describe('readVoiceSettings / knownBrief / hadAnsweredCall', () => {
  it('reads the provider, defaulting to exotel', async () => {
    settings = [{ key: 'voice_provider', value: 'twilio_test' }]
    expect((await readVoiceSettings()).provider).toBe('twilio_test')
    settings = [{ key: 'voice_provider', value: 'bogus' }]
    expect((await readVoiceSettings()).provider).toBe('exotel')
  })

  it('merges contact fields across calls', async () => {
    briefRows = [{ data: { args: { contact: { phone: '98765' } } } }, { data: { args: { contact: { email: 'a@b.in' }, style: '  ' } } }]
    expect(await knownBrief('k1')).toEqual({ contact: { phone: '98765', email: 'a@b.in' } })
  })

  it('carries highlights over calls without repeating them', async () => {
    briefRows = [{ data: { args: { what_they_do: 'silk', highlights: ['handloom'] } } }, { data: { args: { highlights: ['handloom', 'since 1980'] } } }]
    expect(await knownBrief('k1')).toEqual({ whatTheyDo: 'silk', highlights: ['handloom', 'since 1980'] })
  })

  it('knows whether an earlier call was answered, optionally leaving one call out', async () => {
    expect(await hadAnsweredCall('k1')).toBe(true)
    expect(h.query.mock.calls.at(-1)![1]).toEqual(['k1', null])
    h.query.mockResolvedValue({ rows: [] })
    expect(await hadAnsweredCall('k1', 'c1')).toBe(false)
    expect(h.query.mock.calls.at(-1)![1]).toEqual(['k1', 'c1'])
  })
})
