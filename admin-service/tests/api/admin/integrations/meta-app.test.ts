import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: (_r: string, scopes: string[], s: string) => scopes.includes(s) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn(async () => ({ tenantId: 't-acme', slug: 'acme' })) }))
vi.mock('@/lib/catalog/brand', () => ({
  platformOAuthBaseUrl: () => 'https://admin.jeffistores.in',
  storeBaseUrlAsync: async () => 'https://acme.jeffistores.in',
}))
const creds = new Map<string, any>()
vi.mock('@/lib/tenant-registry', () => ({
  getTenant: vi.fn(),
  controlPlanePool: vi.fn(),
  getIntegrationCredential: vi.fn(async (t: string, p: string) => creds.get(`${t}:${p}`) ?? null),
  saveIntegrationCredential: vi.fn(async (c: any) =>
    creds.set(`${c.tenantId}:${c.provider}`, { config_enc: c.configEnc, status: 'connected', meta: c.meta })
  ),
  deleteIntegrationCredential: vi.fn(async (t: string, p: string) => creds.delete(`${t}:${p}`)),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

import { GET, POST, DELETE } from '@admin/app/api/(admin)/admin/integrations/meta-app/route'
import { requireAdminScope } from '@/lib/auth/jwt'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const URL_ = 'https://admin-acme.jeffistores.in/api/admin/integrations/meta-app'
const SECRET = 'abcdef0123456789abcdef0123456789'
const post = (body: unknown) => POST(new NextRequest(URL_, { method: 'POST', body: JSON.stringify(body) }))
const as = (scopes: string[]) => vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes } as any)

beforeEach(() => {
  vi.clearAllMocks()
  creds.clear()
  as(['meta_ads:write', 'meta_ads:read'])
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: '7770001|apptoken' }) })
})

describe('own Meta app route', () => {
  it('verifies with an app access token, saves, and never returns the secret', async () => {
    const r = await post({ appId: '7770001', appSecret: SECRET, loginConfigId: '5550001' })
    expect(r.status).toBe(200)
    const u = new URL(fetchMock.mock.calls[0][0])
    expect(u.pathname).toBe('/v27.0/oauth/access_token')
    expect(u.searchParams.get('grant_type')).toBe('client_credentials')
    expect(u.searchParams.get('client_id')).toBe('7770001')
    const row = creds.get('t-acme:meta_app')
    expect(JSON.parse(row.config_enc.replace(/^enc:/, ''))).toMatchObject({ appId: '7770001', appSecret: SECRET, loginConfigId: '5550001' })
    expect(row.meta).toEqual({ app_id: '7770001', login_config_id: '5550001', ads_login_config_id: null })

    const got = await (await GET(new NextRequest(URL_))).json()
    expect(got).toMatchObject({
      own: true,
      appId: '7770001',
      loginConfigId: '5550001',
      redirectUris: [
        'https://admin.jeffistores.in/api/admin/social/callback',
        'https://admin.jeffistores.in/api/admin/integrations/meta-ads/callback',
      ],
      dataDeletionUrl: 'https://acme.jeffistores.in/api/meta/data-deletion?app=7770001',
    })
    expect(JSON.stringify(got)).not.toContain(SECRET)
    expect(JSON.stringify(await r.json())).not.toContain(SECRET)
  })

  it('refuses an app Meta rejects and saves nothing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'Error validating client secret.' } }) })
    const r = await post({ appId: '7770001', appSecret: SECRET })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toContain('Error validating client secret.')
    expect(creds.size).toBe(0)
  })

  it('keeps the saved secret when only the configuration ids change, and removes the app', async () => {
    await post({ appId: '7770001', appSecret: SECRET })
    const r = await post({ appId: '7770001', appSecret: '', adsLoginConfigId: '6660001' })
    expect(r.status).toBe(200)
    expect(JSON.parse(creds.get('t-acme:meta_app').config_enc.replace(/^enc:/, ''))).toMatchObject({ appSecret: SECRET, adsLoginConfigId: '6660001' })

    expect((await DELETE(new NextRequest(URL_, { method: 'DELETE' }))).status).toBe(200)
    expect(await (await GET(new NextRequest(URL_))).json()).toMatchObject({ own: false })
  })

  it('accepts the Social scope and refuses an admin with neither', async () => {
    as(['social:write'])
    expect((await post({ appId: '7770001', appSecret: SECRET })).status).toBe(200)
    as(['social:read'])
    expect((await post({ appId: '7770001', appSecret: SECRET })).status).toBe(403)
  })
})
