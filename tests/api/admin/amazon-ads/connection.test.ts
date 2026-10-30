import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn(async () => ({ adminId: 'a1' })) }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(), resolveTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({
  getIntegrationCredential: vi.fn(async () => null),
  saveIntegrationCredential: vi.fn(),
  deleteIntegrationCredential: vi.fn(),
  getTenant: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

import { GET, POST } from '@controller/app/api/(admin)/admin/amazon-ads/connection/route'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const post = (body: unknown) =>
  new NextRequest('https://admin.jeffistores.in/api/admin/amazon-ads/connection', { method: 'POST', body: JSON.stringify(body) })
const profiles = [{ profileId: 42, countryCode: 'IN', currencyCode: 'INR', accountInfo: { name: 'Jeffi', type: 'seller' } }]
const saved = () => JSON.parse(String(vi.mocked(saveIntegrationCredential).mock.calls[0][0].configEnc).replace(/^enc:/, ''))
const RT = 'Atzr|refresh-token-value-123'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.AMAZON_ADS_CLIENT_ID
  delete process.env.AMAZON_ADS_CLIENT_SECRET
  vi.mocked(resolveTenantId).mockResolvedValue(null)
  vi.mocked(getIntegrationCredential).mockResolvedValue(null)
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/auth/o2/token') ? json({ access_token: 'at', expires_in: 3600 }) : json(profiles)
  )
})

describe('Amazon Ads manual connection with the owner app', () => {
  it('requires the app client id and secret when the platform app env is missing', async () => {
    const r = await POST(post({ refreshToken: RT, profileId: '42' }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/Client ID and Client Secret/)
    const half = await POST(post({ refreshToken: RT, profileId: '42', clientId: 'amzn1.application-oa2-client.abc' }))
    expect(half.status).toBe(400)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('stores the own app encrypted under the flagship platform id and never returns the secret', async () => {
    const r = await POST(
      post({ refreshToken: RT, profileId: '42', clientId: 'amzn1.application-oa2-client.abc', clientSecret: 'own-secret-value' })
    )
    expect(r.status).toBe(200)
    const call = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(call.tenantId).toBe(PLATFORM)
    expect(call.configEnc.startsWith('enc:')).toBe(true)
    expect(JSON.stringify(call.meta)).not.toContain('own-secret-value')
    expect(saved()).toMatchObject({
      refresh_token: RT,
      client_id: 'amzn1.application-oa2-client.abc',
      client_secret: 'own-secret-value',
      profile_id: '42',
      connected_via: 'manual',
    })
    const tokenCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/auth/o2/token'))!
    expect(new URLSearchParams(tokenCall[1].body).get('client_id')).toBe('amzn1.application-oa2-client.abc')
    expect(JSON.stringify(await r.json())).not.toContain('own-secret-value')

    vi.mocked(getIntegrationCredential).mockResolvedValue({ status: 'connected', config_enc: call.configEnc, meta: {} } as any)
    const status = await (await GET(new NextRequest('https://x/api/admin/amazon-ads/connection'))).json()
    expect(status).toMatchObject({ connected: true, envReady: false, appReady: true, ownApp: true, clientId: 'amzn1.application-oa2-client.abc' })
    expect(JSON.stringify(status)).not.toContain('own-secret-value')
    expect(JSON.stringify(status)).not.toContain(RT)
  })

  it('saves a pending entry and lists profiles when no profile id is given', async () => {
    const r = await POST(post({ refreshToken: RT, clientId: 'amzn1.application-oa2-client.abc', clientSecret: 'own-secret-value' }))
    const d = await r.json()
    expect(d).toMatchObject({ ok: true, pending: true, profiles: [{ profileId: '42', name: 'Jeffi' }] })
    expect(saved().profile_id).toBeUndefined()
  })

  it('keeps the client id and secret optional when the platform app is set', async () => {
    process.env.AMAZON_ADS_CLIENT_ID = 'env-client'
    process.env.AMAZON_ADS_CLIENT_SECRET = 'env-secret'
    vi.mocked(resolveTenantId).mockResolvedValue('t-acme')
    const r = await POST(post({ refreshToken: RT, profileId: '42' }))
    expect(r.status).toBe(200)
    expect(vi.mocked(saveIntegrationCredential).mock.calls[0][0].tenantId).toBe('t-acme')
    expect(saved().client_id).toBeUndefined()
  })
})
