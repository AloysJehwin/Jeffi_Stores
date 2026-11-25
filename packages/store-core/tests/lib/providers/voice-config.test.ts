import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('server-only', () => ({}))
const query = vi.hoisted(() => vi.fn())
const store = vi.hoisted(() => new Map<string, { config_enc: string }>())
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query }),
  getIntegrationCredential: vi.fn(async (t: string, p: string) => store.get(`${t}:${p}`) ?? null),
  saveIntegrationCredential: vi.fn(async (c: { tenantId: string; provider: string; configEnc: string }) => {
    store.set(`${c.tenantId}:${c.provider}`, { config_enc: c.configEnc })
  }),
  deleteIntegrationCredential: vi.fn(async (t: string, p: string) => {
    store.delete(`${t}:${p}`)
  }),
}))
const identity = vi.hoisted(() => vi.fn())
vi.mock('@/lib/providers/policy', () => ({ getAnthropicIdentity: identity }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(async () => null) }))

import {
  getVoiceConfig,
  getVoiceConfigPublic,
  saveVoiceCredential,
  clearVoiceCredential,
  testExotelCredentials,
  VoiceCredentialError,
} from '@/lib/providers/voice-config'
import { saveIntegrationCredential } from '@/lib/tenant-registry'

const P = '00000000-0000-0000-0000-000000000000'
const KEY = 'exotel-key-AAAA1111'
const TOKEN = 'exotel-token-BBBB2222'
const SARVAM = 'sarvam-secret-CCCC3333'
const settings = (rows: { key: string; value: unknown }[]) => query.mockResolvedValue({ rows })
const exotelSettings = { exotel: { accountSid: 'jeffi1', callerId: '+911401234567', appId: '12345' } }

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  vi.stubEnv('SOCIAL_TOKEN_ENC_KEY', 'a'.repeat(64))
  vi.stubEnv('TWILIO_ACCOUNT_SID', '')
  vi.stubEnv('TWILIO_AUTH_TOKEN', '')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('ANTHROPIC_ORGANIZATION_ID', '')
  identity.mockResolvedValue(null)
  settings([])
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('voice credentials', () => {
  it('stores encrypted, merges a partial replace, and clears', async () => {
    const st = await saveVoiceCredential('exotel', { apiKey: KEY, apiToken: TOKEN })
    expect(st).toEqual({ apiKey: { configured: true, last4: '1111' }, apiToken: { configured: true, last4: '2222' } })
    const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(saved.tenantId).toBe(P)
    expect(saved.configEnc).toMatch(/^v1:/)
    expect(saved.configEnc).not.toContain(KEY)
    expect(JSON.stringify(saved.meta)).not.toContain('1111')

    await saveVoiceCredential('exotel', { apiToken: 'exotel-token-NEW-9999' })
    const c = await getVoiceConfig()
    expect(c.exotel.apiKey).toBe(KEY)
    expect(c.exotel.apiToken).toBe('exotel-token-NEW-9999')

    await clearVoiceCredential('exotel')
    expect((await getVoiceConfig()).exotel.apiKey).toBeNull()
  })

  it('refuses an incomplete set, unknown fields and bad formats', async () => {
    await expect(saveVoiceCredential('exotel', { apiKey: KEY })).rejects.toThrow(/apiToken/)
    await expect(saveVoiceCredential('sarvam', { apiKey: SARVAM, extra: 'x' })).rejects.toBeInstanceOf(VoiceCredentialError)
    await expect(saveVoiceCredential('twilio_voice', { accountSid: 'nope', authToken: 'a'.repeat(32) })).rejects.toThrow(/AC/)
    await expect(saveVoiceCredential('anthropic_voice', { apiKey: 'x'.repeat(30) })).rejects.toThrow(/sk-ant-/)
    await expect(saveVoiceCredential('sarvam', {})).rejects.toThrow(/Nothing/)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })
})

describe('getVoiceConfig', () => {
  it('merges settings and secrets, and is ready when the chosen provider, Sarvam and Claude are set', async () => {
    settings([
      { key: 'voice_provider', value: 'exotel' },
      { key: 'voice_config', value: exotelSettings },
    ])
    await saveVoiceCredential('exotel', { apiKey: KEY, apiToken: TOKEN })
    await saveVoiceCredential('sarvam', { apiKey: SARVAM })
    let c = await getVoiceConfig()
    expect(c.exotel).toMatchObject({ accountSid: 'jeffi1', subdomain: 'api.in.exotel.com', apiKey: KEY, configured: true })
    expect(c.sarvam).toMatchObject({ sttModel: 'saaras:v3', ttsModel: 'bulbul:v3', apiKey: SARVAM, configured: true })
    expect(c.llmModel).toBe('claude-haiku-5-5')
    expect(c.anthropic.configured).toBe(false)
    expect(c.ready).toBe(false)

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env-key-0000')
    c = await getVoiceConfig()
    expect(c.anthropic).toEqual({ apiKey: 'sk-ant-env-key-0000', source: 'env', federation: false, configured: true })
    expect(c.ready).toBe(true)
  })

  it('falls back to the messaging Twilio account for the test line', async () => {
    settings([
      { key: 'voice_provider', value: 'twilio_test' },
      { key: 'voice_config', value: { twilioTest: { from: '+14155550100' }, testNumbers: ['+919876543210'] } },
    ])
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC' + '1'.repeat(32))
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'env-auth-token-5555')
    const c = await getVoiceConfig()
    expect(c.provider).toBe('twilio_test')
    expect(c.twilioTest).toMatchObject({ source: 'messaging', authToken: 'env-auth-token-5555', configured: true })

    await saveVoiceCredential('twilio_voice', { accountSid: 'AC' + 'a'.repeat(32), authToken: 'stored-auth-token-6666' })
    expect((await getVoiceConfig()).twilioTest).toMatchObject({ source: 'stored', authToken: 'stored-auth-token-6666' })
  })
})

// The wire contract with voice-service: voice-service/tests/fixtures/voice-config.sample.json is what
// voice-service's provider_config.merge is tested against. If getVoiceConfig's shape changes, this fails until
// the fixture (and merge) follow.
describe('voice-service contract fixture', () => {
  it('equals a fully configured getVoiceConfig() result', async () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'voice-service/tests/fixtures/voice-config.sample.json'), 'utf8'))
    settings([
      { key: 'voice_provider', value: 'exotel' },
      {
        key: 'voice_config',
        value: {
          exotel: { accountSid: 'fakeacct', callerId: '+911401234567', appId: '12345' },
          twilioTest: { from: '+14155550100' },
          testNumbers: ['+919876543210', '+919876543211'],
        },
      },
    ])
    await saveVoiceCredential('exotel', { apiKey: 'fake-exotel-key-0001', apiToken: 'fake-exotel-token-0002' })
    await saveVoiceCredential('sarvam', { apiKey: 'fake-sarvam-key-0004' })
    await saveVoiceCredential('twilio_voice', { accountSid: 'AC' + '0'.repeat(32), authToken: 'fake-twilio-auth-0003' })
    await saveVoiceCredential('anthropic_voice', { apiKey: 'sk-ant-fake-voice-key-0005' })
    identity.mockResolvedValue({ workspaceId: 'wrkspc_fake', serviceAccountId: 'svac_fake', federationRuleId: 'fdrl_fake' })
    vi.stubEnv('ANTHROPIC_ORGANIZATION_ID', '00000000-0000-0000-0000-000000000001')
    const c = await getVoiceConfig()
    expect(JSON.parse(JSON.stringify(c))).toEqual(fixture)
  })
})

describe('anthropic federation', () => {
  const ids = { workspaceId: 'wrkspc_1', serviceAccountId: 'svac_1', federationRuleId: 'fdrl_1' }
  const org = '11111111-2222-3333-4444-555555555555'

  it('reports the platform identity plus the org id, and counts as configured without a key', async () => {
    identity.mockResolvedValue(ids)
    vi.stubEnv('ANTHROPIC_ORGANIZATION_ID', org)
    const c = await getVoiceConfig()
    expect(identity).toHaveBeenCalledWith(null)
    expect(c.anthropicIdentity).toEqual({ organizationId: org, ...ids })
    expect(c.anthropic).toEqual({ apiKey: null, source: null, federation: true, configured: true })
    const p = await getVoiceConfigPublic()
    expect(p.anthropic.federation).toBe(true)
    expect(JSON.stringify(p)).not.toContain('wrkspc_1')
  })

  it('is null without the org id or without an identity row; a stored key stays as the fallback', async () => {
    identity.mockResolvedValue(ids)
    expect((await getVoiceConfig()).anthropicIdentity).toBeNull()
    vi.stubEnv('ANTHROPIC_ORGANIZATION_ID', org)
    identity.mockResolvedValue(null)
    await saveVoiceCredential('anthropic_voice', { apiKey: 'sk-ant-' + 'x'.repeat(30) })
    const c = await getVoiceConfig()
    expect(c.anthropicIdentity).toBeNull()
    expect(c.anthropic).toMatchObject({ source: 'stored', federation: false, configured: true })
  })
})

describe('getVoiceConfigPublic', () => {
  it('masks every secret to configured + last 4 and shows no digits of env values', async () => {
    settings([{ key: 'voice_config', value: exotelSettings }])
    await saveVoiceCredential('exotel', { apiKey: KEY, apiToken: TOKEN })
    await saveVoiceCredential('sarvam', { apiKey: SARVAM })
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env-key-0000')
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC' + '1'.repeat(32))
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'env-auth-token-5555')
    const p = await getVoiceConfigPublic()
    const json = JSON.stringify(p)
    for (const s of [KEY, TOKEN, SARVAM, 'sk-ant-env-key-0000', 'env-auth-token-5555', '1'.repeat(32)]) expect(json).not.toContain(s)
    expect(p.exotel.apiKey).toEqual({ configured: true, last4: '1111' })
    expect(p.sarvam.apiKey).toEqual({ configured: true, last4: '3333' })
    expect(p.anthropic.apiKey).toEqual({ configured: true, last4: null })
    expect(p.twilioTest.authToken).toEqual({ configured: true, last4: null })
    expect(p.exotel.accountSid).toBe('jeffi1')
  })
})

describe('testExotelCredentials', () => {
  it('needs saved credentials and calls only the fixed Exotel host, read-only', async () => {
    expect((await testExotelCredentials()).ok).toBe(false)
    settings([{ key: 'voice_config', value: exotelSettings }])
    await saveVoiceCredential('exotel', { apiKey: KEY, apiToken: TOKEN })
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await testExotelCredentials()
    expect(r.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.in.exotel.com/v1/Accounts/jeffi1/Balance.json')
    expect(init.method ?? 'GET').toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from(`${KEY}:${TOKEN}`).toString('base64')}`)
    expect(r.message).not.toContain(KEY)

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 })
    expect(await testExotelCredentials()).toEqual({ ok: false, message: 'Exotel rejected the API key or token.' })
  })
})
