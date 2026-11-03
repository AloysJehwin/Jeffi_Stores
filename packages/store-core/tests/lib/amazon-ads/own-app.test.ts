import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(async () => 't-acme'), resolveTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({
  getIntegrationCredential: vi.fn(async () => null),
  saveIntegrationCredential: vi.fn(),
  deleteIntegrationCredential: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

import { adsApp, adsAppReady, amazonAdsClient, listProfiles } from '@/lib/amazon-ads/client'
import { getIntegrationCredential } from '@/lib/tenant-registry'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const row = (cfg: Record<string, unknown>) => ({ status: 'connected', config_enc: `enc:${JSON.stringify(cfg)}`, meta: {} }) as any

function respond() {
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/auth/o2/token') ? json({ access_token: 'at', expires_in: 3600 }) : json([])
  )
}
const tokenBody = () => new URLSearchParams(fetchMock.mock.calls.find(c => String(c[0]).includes('/auth/o2/token'))![1].body)
const apiHeaders = () => fetchMock.mock.calls.find(c => !String(c[0]).includes('/auth/o2/token'))![1].headers

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AMAZON_ADS_CLIENT_ID = 'env-client'
  process.env.AMAZON_ADS_CLIENT_SECRET = 'env-secret'
  respond()
})

describe('Amazon Ads app credentials', () => {
  it('uses the owner app when stored, else the platform env', () => {
    expect(adsApp({ client_id: 'own', client_secret: 'own-s' })).toEqual({ clientId: 'own', clientSecret: 'own-s' })
    expect(adsApp({ client_id: 'own' })).toEqual({ clientId: 'env-client', clientSecret: 'env-secret' })
    expect(adsApp(null)).toEqual({ clientId: 'env-client', clientSecret: 'env-secret' })
  })

  it('is ready with an own app even when the platform env is missing', () => {
    delete process.env.AMAZON_ADS_CLIENT_ID
    delete process.env.AMAZON_ADS_CLIENT_SECRET
    expect(adsAppReady(null)).toBe(false)
    expect(adsAppReady({ client_id: 'own', client_secret: 'own-s' })).toBe(true)
  })

  it('refreshes and calls the API with the stored app', async () => {
    delete process.env.AMAZON_ADS_CLIENT_ID
    vi.mocked(getIntegrationCredential).mockResolvedValue(
      row({ refresh_token: 'rt-own-app', client_id: 'own-client', client_secret: 'own-secret', profile_id: '42', connected_via: 'manual' })
    )
    const c = await amazonAdsClient()
    await c.request('GET', '/v2/profiles', { profile: false })
    expect(tokenBody().get('client_id')).toBe('own-client')
    expect(tokenBody().get('client_secret')).toBe('own-secret')
    expect(apiHeaders()['Amazon-Advertising-API-ClientId']).toBe('own-client')
  })

  it('falls back to the env app and never reuses another owner token', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue(row({ refresh_token: 'rt-env-app', profile_id: '42', connected_via: 'oauth' }))
    const c = await amazonAdsClient()
    await c.request('GET', '/v2/profiles', { profile: false })
    expect(tokenBody().get('client_id')).toBe('env-client')
    expect(tokenBody().get('client_secret')).toBe('env-secret')
    expect(apiHeaders()['Amazon-Advertising-API-ClientId']).toBe('env-client')

    fetchMock.mockClear()
    respond()
    await listProfiles('rt-env-app', { clientId: 'other-client', clientSecret: 'other-secret' })
    expect(tokenBody().get('client_id')).toBe('other-client')
    expect(apiHeaders()['Amazon-Advertising-API-ClientId']).toBe('other-client')
  })
})
