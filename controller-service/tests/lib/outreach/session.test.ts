import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn(), getProgramState: vi.fn() }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))
vi.mock('@controller/lib/outreach/program-state', () => ({ getProgramState: h.getProgramState }))

import { buildSession, knownBrief, readVoiceSettings, MAX_DURATION_S, SILENCE_S } from '@controller/lib/outreach/session'
import { LINES, SCRIPT_VERSION, TOOL_NAMES } from '@controller/lib/outreach/prompt'

const CALL = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-25T06:00:00Z')
let call: Record<string, unknown> | null
let contact: Record<string, unknown>
let settings: { key: string; value: unknown }[]
let briefRows: unknown[]
let answeredBefore = false

beforeEach(() => {
  vi.clearAllMocks()
  call = { id: CALL, contact_id: 'k1', language: 'ta' }
  contact = {
    id: 'k1',
    program: 'showcase-offer',
    business_name: 'Ravi Silks',
    owner_name: 'Ravi',
    category: 'Sarees',
    city: 'Chennai',
    language: 'ta',
    status: 'calling',
    consent_whatsapp_at: null,
    showcase_site_id: null,
  }
  settings = [
    { key: 'voice_provider', value: 'exotel' },
    { key: 'voice_config', value: { sarvam: { voices: { ta: 'kavya' } } } },
  ]
  briefRows = []
  answeredBefore = false
  h.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT * FROM outreach_calls')) return { rows: call ? [call] : [] }
    if (sql.startsWith('SELECT * FROM outreach_contacts')) return { rows: [contact] }
    if (sql.startsWith('SELECT key, value FROM platform_provider_settings')) return { rows: settings }
    if (sql.startsWith('SELECT data FROM outreach_events')) return { rows: briefRows }
    if (sql.startsWith('SELECT 1 FROM outreach_calls')) return { rows: answeredBefore ? [{}] : [] }
    return { rows: [] }
  })
  h.getProgramState.mockResolvedValue({ test_numbers: ['+919876543210'] })
})

describe('buildSession', () => {
  it('assembles the contract fields for voice-service', async () => {
    const s = (await buildSession(CALL, NOW))!
    expect(s.language).toBe('ta')
    expect(s.persona).toEqual({ name: 'Kavya', voiceId: 'kavya' })
    expect(s.greeting).toBe(LINES.ta.greeting('Kavya', { business: 'Ravi Silks', owner: 'Ravi' }))
    expect(s.greeting).toContain('ரெக்கார்ட்')
    expect(s.tools.map(t => t.name)).toEqual([...TOOL_NAMES])
    expect(s.maxDurationS).toBe(MAX_DURATION_S)
    expect(s.silenceS).toBe(SILENCE_S)
    expect(s.testNumbers).toEqual(['+919876543210'])
    expect(s.scriptVersion).toBe(SCRIPT_VERSION)
    expect(s.systemPrompt).toContain('Ravi Silks')
    expect(s.systemPrompt).toContain('Tamil')
    expect(s.systemPrompt).toContain(LINES.ta.aiAnswer)
    expect(s.systemPrompt).toContain('Never claim to be human')
  })

  it('promises WhatsApp in the failure apology only with consent', async () => {
    expect((await buildSession(CALL, NOW))!.apology).toBe(LINES.ta.apologyCallBack)
    contact.consent_whatsapp_at = '2026-11-25T05:00:00Z'
    const s = (await buildSession(CALL, NOW))!
    expect(s.apology).toBe(LINES.ta.apologyWhatsApp)
    expect(s.systemPrompt).toContain('WhatsApp consent: already given')
  })

  it('a follow-up call greets again and carries over what is known', async () => {
    answeredBefore = true
    contact.showcase_site_id = 's1'
    briefRows = [{ data: { args: { what_they_do: 'silk sarees', highlights: ['handloom'] } } }, { data: { args: { hours: '10 to 9', highlights: ['handloom', 'since 1980'] } } }]
    const s = (await buildSession(CALL, NOW))!
    expect(s.greeting).toBe(LINES.ta.greetingAgain('Kavya'))
    expect(s.systemPrompt).toContain('What they do: silk sarees')
    expect(s.systemPrompt).toContain('Highlights: handloom; since 1980')
    expect(s.systemPrompt).toContain('do not call startPreview again')
  })

  it('falls back to English, the default voice and no test numbers', async () => {
    call = { id: CALL, contact_id: 'k1', language: null }
    contact.language = 'xx'
    settings = []
    h.getProgramState.mockRejectedValue(new Error('unknown program'))
    const s = (await buildSession(CALL, NOW))!
    expect(s.language).toBe('en')
    expect(s.persona).toEqual({ name: 'Priya', voiceId: 'ishita' })
    expect(s.testNumbers).toEqual([])
  })

  it('is null for an unknown call', async () => {
    call = null
    expect(await buildSession(CALL, NOW)).toBeNull()
  })
})

describe('readVoiceSettings / knownBrief', () => {
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
})
