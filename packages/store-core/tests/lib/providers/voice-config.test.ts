import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('server-only', () => ({}))
const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
const identity = vi.hoisted(() => vi.fn())
vi.mock('@/lib/providers/policy', () => ({ getAnthropicIdentity: identity }))

import {
  getVoiceConfigView,
  voiceSecretsStatus,
  testExotelCredentials,
  testTwilioCredentials,
  testAzureSpeechCredentials,
  testSarvamCredentials,
} from '@/lib/providers/voice-config'

const KEY = 'exotel-key-AAAA1111'
const TOKEN = 'exotel-token-BBBB2222'
const SARVAM = 'sarvam-secret-CCCC3333'
const AZURE = 'azure-speech-key-DDDD4444'
const settings = (rows: { key: string; value: unknown }[]) => query.mockResolvedValue({ rows })
const exotelSettings = { exotel: { accountSid: 'jeffi1', callerId: '+911401234567', appId: '12345' } }
const SECRET_ENV = [
  'EXOTEL_API_KEY',
  'EXOTEL_API_TOKEN',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'SARVAM_API_KEY',
  'AZURE_SPEECH_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_ORGANIZATION_ID',
]

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of SECRET_ENV) vi.stubEnv(k, '')
  identity.mockResolvedValue(null)
  settings([])
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('voiceSecretsStatus', () => {
  it('lists every voice secret by name and presence, never a value', () => {
    expect(voiceSecretsStatus()).toEqual([
      { name: 'EXOTEL_API_KEY', group: 'calling', present: false },
      { name: 'EXOTEL_API_TOKEN', group: 'calling', present: false },
      { name: 'TWILIO_ACCOUNT_SID', group: 'calling', present: false },
      { name: 'TWILIO_AUTH_TOKEN', group: 'calling', present: false },
      { name: 'SARVAM_API_KEY', group: 'voice', present: false },
      { name: 'AZURE_SPEECH_KEY', group: 'voice', present: false },
      { name: 'ANTHROPIC_API_KEY', group: 'voice', present: false },
    ])
    vi.stubEnv('EXOTEL_API_KEY', KEY)
    vi.stubEnv('SARVAM_API_KEY', '   ')
    const s = voiceSecretsStatus()
    expect(s.find(x => x.name === 'EXOTEL_API_KEY')?.present).toBe(true)
    expect(s.find(x => x.name === 'SARVAM_API_KEY')?.present).toBe(false)
    expect(JSON.stringify(s)).not.toContain(KEY)
  })
})

describe('getVoiceConfigView', () => {
  it('defaults to Exotel with nothing ready and no secret in the result', async () => {
    const v = await getVoiceConfigView()
    expect(v.provider).toBe('exotel')
    expect(v.ready).toBe(false)
    expect(v.parts).toEqual({ exotel: false, twilio: false, calling: false, sarvam: false, azure: false, speech: false, claude: false })
    expect(v.speech).toEqual({ sttProvider: 'sarvam', ttsProvider: 'sarvam' })
    expect(v.azureSpeech).toMatchObject({ region: 'centralindia' })
    expect(Object.keys(v.azureSpeech.voices).sort()).toEqual(['bn', 'en', 'gu', 'hi', 'kn', 'ml', 'mr', 'ta', 'te'])
  })

  it('is ready when the chosen provider, a speech engine and Claude are set, from env presence', async () => {
    settings([
      { key: 'voice_provider', value: 'exotel' },
      { key: 'voice_config', value: exotelSettings },
    ])
    vi.stubEnv('EXOTEL_API_KEY', KEY)
    vi.stubEnv('EXOTEL_API_TOKEN', TOKEN)
    vi.stubEnv('SARVAM_API_KEY', SARVAM)
    let v = await getVoiceConfigView()
    expect(v.exotel).toMatchObject({ accountSid: 'jeffi1', subdomain: 'api.in.exotel.com' })
    expect(v.parts).toMatchObject({ exotel: true, calling: true, sarvam: true, speech: true, claude: false })
    expect(v.ready).toBe(false)

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env-key-0000')
    v = await getVoiceConfigView()
    expect(v.parts.claude).toBe(true)
    expect(v.ready).toBe(true)
    expect(JSON.stringify(v)).not.toMatch(new RegExp([KEY, TOKEN, SARVAM, 'sk-ant-env-key-0000'].join('|')))
  })

  it('needs the Exotel account details as well as its secrets', async () => {
    vi.stubEnv('EXOTEL_API_KEY', KEY)
    vi.stubEnv('EXOTEL_API_TOKEN', TOKEN)
    expect((await getVoiceConfigView()).parts.exotel).toBe(false)
  })

  it('readies the Twilio test line from the env account, a from-number and a test number', async () => {
    settings([
      { key: 'voice_provider', value: 'twilio_test' },
      { key: 'voice_config', value: { twilioTest: { from: '+14155550100' }, testNumbers: ['+919876543210'] } },
    ])
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC' + '1'.repeat(32))
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'env-auth-token-5555')
    const v = await getVoiceConfigView()
    expect(v.provider).toBe('twilio_test')
    expect(v.twilioTest.from).toBe('+14155550100')
    expect(v.parts).toMatchObject({ twilio: true, calling: true, exotel: false })
  })

  it('is ready with Azure alone, and not with neither speech engine', async () => {
    settings([{ key: 'voice_config', value: exotelSettings }])
    vi.stubEnv('EXOTEL_API_KEY', KEY)
    vi.stubEnv('EXOTEL_API_TOKEN', TOKEN)
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env-key-0000')
    expect((await getVoiceConfigView()).ready).toBe(false)
    vi.stubEnv('AZURE_SPEECH_KEY', AZURE)
    const v = await getVoiceConfigView()
    expect(v.parts).toMatchObject({ azure: true, sarvam: false, speech: true })
    expect(v.ready).toBe(true)
  })

  it('takes the stored engines, region and voices over the defaults', async () => {
    settings([
      {
        key: 'voice_config',
        value: { speech: { ttsProvider: 'azure' }, azureSpeech: { region: 'SouthIndia', voices: { hi: 'hi-IN-MadhurNeural' } } },
      },
    ])
    const v = await getVoiceConfigView()
    expect(v.speech).toEqual({ sttProvider: 'sarvam', ttsProvider: 'azure' })
    expect(v.azureSpeech.region).toBe('southindia')
    expect(v.azureSpeech.voices).toMatchObject({ hi: 'hi-IN-MadhurNeural', ta: 'ta-IN-PallaviNeural' })
  })

  describe('anthropic federation', () => {
    const ids = { workspaceId: 'wrkspc_1', serviceAccountId: 'svac_1', federationRuleId: 'fdrl_1' }
    const org = '11111111-2222-3333-4444-555555555555'

    it('reports the platform identity plus the org id, and counts as Claude without a key', async () => {
      identity.mockResolvedValue(ids)
      vi.stubEnv('ANTHROPIC_ORGANIZATION_ID', org)
      const v = await getVoiceConfigView()
      expect(identity).toHaveBeenCalledWith()
      expect(v.anthropicIdentity).toEqual({ organizationId: org, ...ids })
      expect(v.parts.claude).toBe(true)
    })

    it('is null without the org id or without an identity row', async () => {
      identity.mockResolvedValue(ids)
      expect((await getVoiceConfigView()).anthropicIdentity).toBeNull()
      vi.stubEnv('ANTHROPIC_ORGANIZATION_ID', org)
      identity.mockResolvedValue(null)
      const v = await getVoiceConfigView()
      expect(v.anthropicIdentity).toBeNull()
      expect(v.parts.claude).toBe(false)
    })
  })
})

// The wire contract with voice-service: voice-service/tests/fixtures/voice-config.sample.json is what
// voice-service's provider_config.merge is tested against. If getVoiceConfigView's shape changes, this fails until
// the fixture (and merge) follow.
describe('voice-service contract fixture', () => {
  it('equals a fully configured getVoiceConfigView() result', async () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'voice-service/tests/fixtures/voice-config.sample.json'), 'utf8'))
    settings([
      { key: 'voice_provider', value: 'exotel' },
      {
        key: 'voice_config',
        value: {
          exotel: { accountSid: 'fakeacct', callerId: '+911401234567', appId: '12345' },
          twilioTest: { from: '+14155550100' },
          testNumbers: ['+919876543210', '+919876543211'],
          speech: { sttProvider: 'azure' },
        },
      },
    ])
    for (const [k, v] of Object.entries({
      EXOTEL_API_KEY: 'fake',
      EXOTEL_API_TOKEN: 'fake',
      TWILIO_ACCOUNT_SID: 'fake',
      TWILIO_AUTH_TOKEN: 'fake',
      SARVAM_API_KEY: 'fake',
      AZURE_SPEECH_KEY: 'fake',
      ANTHROPIC_ORGANIZATION_ID: '00000000-0000-0000-0000-000000000001',
    }))
      vi.stubEnv(k, v)
    identity.mockResolvedValue({ workspaceId: 'wrkspc_fake', serviceAccountId: 'svac_fake', federationRuleId: 'fdrl_fake' })
    expect(JSON.parse(JSON.stringify(await getVoiceConfigView()))).toEqual(fixture)
  })
})

describe('credential tests read the env secrets, read-only', () => {
  const fetchMock = () => {
    const m = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', m)
    return m
  }
  const call = (m: ReturnType<typeof fetchMock>) => m.mock.calls[0] as unknown as [string, RequestInit]

  it('Exotel: names the missing secrets, then reads the balance on the fixed host', async () => {
    expect(await testExotelCredentials()).toEqual({ ok: false, message: expect.stringMatching(/EXOTEL_API_KEY and EXOTEL_API_TOKEN/) })
    vi.stubEnv('EXOTEL_API_KEY', KEY)
    vi.stubEnv('EXOTEL_API_TOKEN', TOKEN)
    expect((await testExotelCredentials()).message).toMatch(/account SID/)
    settings([{ key: 'voice_config', value: exotelSettings }])
    const m = fetchMock()
    const r = await testExotelCredentials()
    expect(r.ok).toBe(true)
    const [url, init] = call(m)
    expect(url).toBe('https://api.in.exotel.com/v1/Accounts/jeffi1/Balance.json')
    expect(init.method ?? 'GET').toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from(`${KEY}:${TOKEN}`).toString('base64')}`)
    expect(r.message).not.toContain(KEY)
    m.mockResolvedValueOnce({ ok: false, status: 401 })
    expect(await testExotelCredentials()).toEqual({ ok: false, message: 'Exotel rejected the API key or token.' })
    m.mockResolvedValueOnce({ ok: false, status: 404 })
    expect((await testExotelCredentials()).message).toMatch(/No account jeffi1/)
    m.mockRejectedValueOnce(new Error('network'))
    expect(await testExotelCredentials()).toEqual({ ok: false, message: 'Exotel did not answer.' })
  })

  it('Twilio: reads the account with the env credentials', async () => {
    expect((await testTwilioCredentials()).ok).toBe(false)
    const sid = 'AC' + '1'.repeat(32)
    vi.stubEnv('TWILIO_ACCOUNT_SID', sid)
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'env-auth-token-5555')
    const m = fetchMock()
    expect((await testTwilioCredentials()).ok).toBe(true)
    const [url, init] = call(m)
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`)
    expect(init.method ?? 'GET').toBe('GET')
    m.mockResolvedValueOnce({ ok: false, status: 401 })
    expect((await testTwilioCredentials()).message).toMatch(/rejected/)
    m.mockResolvedValueOnce({ ok: false, status: 500 })
    expect(await testTwilioCredentials()).toEqual({ ok: false, message: 'Twilio answered 500.' })
    m.mockRejectedValueOnce(new Error('network'))
    expect((await testTwilioCredentials()).message).toBe('Twilio did not answer.')
  })

  it('Azure Speech: asks the configured region for a token', async () => {
    expect((await testAzureSpeechCredentials()).message).toMatch(/AZURE_SPEECH_KEY is not set/)
    vi.stubEnv('AZURE_SPEECH_KEY', AZURE)
    settings([{ key: 'voice_config', value: { azureSpeech: { region: 'southindia' } } }])
    const m = fetchMock()
    const r = await testAzureSpeechCredentials()
    expect(r).toEqual({ ok: true, message: 'Azure Speech accepted the key (southindia).' })
    const [url, init] = call(m)
    expect(url).toBe('https://southindia.api.cognitive.microsoft.com/sts/v1.0/issueToken')
    expect((init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe(AZURE)
    expect(r.message).not.toContain(AZURE)
    m.mockResolvedValueOnce({ ok: false, status: 401 })
    expect((await testAzureSpeechCredentials()).message).toMatch(/rejected the key for southindia/)
    m.mockResolvedValueOnce({ ok: false, status: 500 })
    expect(await testAzureSpeechCredentials()).toEqual({ ok: false, message: 'Azure Speech answered 500.' })
    m.mockRejectedValueOnce(new Error('network'))
    expect(await testAzureSpeechCredentials()).toEqual({ ok: false, message: 'Azure Speech did not answer.' })
  })

  it('Sarvam: a refused key fails, a validation error means the key was accepted', async () => {
    expect((await testSarvamCredentials()).message).toMatch(/SARVAM_API_KEY is not set/)
    vi.stubEnv('SARVAM_API_KEY', SARVAM)
    const m = fetchMock()
    m.mockResolvedValueOnce({ ok: false, status: 422 })
    expect(await testSarvamCredentials()).toEqual({ ok: true, message: 'Sarvam accepted the API key.' })
    const [url, init] = call(m)
    expect(url).toBe('https://api.sarvam.ai/text-to-speech')
    expect((init.headers as Record<string, string>)['api-subscription-key']).toBe(SARVAM)
    expect(init.body).toBe('{}')
    m.mockResolvedValueOnce({ ok: false, status: 403 })
    expect(await testSarvamCredentials()).toEqual({ ok: false, message: 'Sarvam rejected the API key.' })
    m.mockResolvedValueOnce({ ok: false, status: 500 })
    expect((await testSarvamCredentials()).message).toBe('Sarvam answered 500.')
    m.mockRejectedValueOnce(new Error('network'))
    expect((await testSarvamCredentials()).message).toBe('Sarvam did not answer.')
  })
})
