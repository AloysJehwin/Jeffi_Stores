import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn(async () => ({ adminId: 'a1', role: 'admin', scopes: [] })) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({
  resolveTenant: vi.fn(async () => ({ tenantId: 't-acme', slug: 'acme' })),
  resolveTenantId: vi.fn(async () => 't-acme'),
}))
vi.mock('@/lib/catalog/brand', () => ({
  currentAdminBaseUrlAsync: vi.fn(async () => 'https://admin-acme.jeffistores.in'),
  currentAdminBaseUrl: () => 'https://admin.jeffistores.in',
  platformOAuthBaseUrl: () => 'https://admin.jeffistores.in',
}))
const creds = new Map<string, { config_enc: string; status: string; meta: any; expires_at: string | null }>()
vi.mock('@/lib/tenant-registry', () => ({
  getTenant: vi.fn(async () => ({ slug: 'acme' })),
  getIntegrationCredential: vi.fn(async (t: string, p: string) => creds.get(`${t}:${p}`) ?? null),
  saveIntegrationCredential: vi.fn(async (c: any) =>
    creds.set(`${c.tenantId}:${c.provider}`, { config_enc: c.configEnc, status: 'connected', meta: c.meta, expires_at: c.expiresAt?.toISOString() ?? null })
  ),
  deleteIntegrationCredential: vi.fn(async (t: string, p: string) => creds.delete(`${t}:${p}`)),
  saveTenantSocialAccount: vi.fn(),
  deleteTenantSocialAccount: vi.fn(),
  getTenantSocialAccounts: vi.fn(async () => []),
  controlPlanePool: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

import { GET as socialConnect } from '@admin/app/api/(admin)/admin/social/connect/[provider]/route'
import { GET as socialCallback } from '@admin/app/api/(admin)/admin/social/callback/route'
import { GET as adsConnect } from '@admin/app/api/(admin)/admin/integrations/meta-ads/connect/route'
import { GET as adsCallback } from '@admin/app/api/(admin)/admin/integrations/meta-ads/callback/route'
import { saveTenantSocialAccount } from '@/lib/tenant-registry'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
const OWN = { appId: '7770001', appSecret: 'own-secret-0123456789', loginConfigId: '5550001' }

function graph(pages: unknown[]) {
  fetchMock.mockImplementation(async (url: string) => {
    const u = new URL(url)
    if (u.pathname.endsWith('/oauth/access_token')) return json({ access_token: u.searchParams.get('code') ? 'short' : 'long', expires_in: 5184000 })
    if (u.pathname.endsWith('/me/permissions')) return json({ data: [{ permission: 'pages_show_list', status: 'granted' }] })
    if (u.pathname.endsWith('/me/accounts')) return json({ data: pages })
    if (u.pathname.endsWith('/me')) return json({ id: 'fbu-9' })
    return json({})
  })
}

const stateOf = (redirect: string) =>
  JSON.parse(Buffer.from(new URL(redirect).searchParams.get('state')!.split('.')[0], 'base64url').toString())
const tokenCalls = () => fetchMock.mock.calls.map(c => new URL(c[0])).filter(u => u.pathname.endsWith('/oauth/access_token'))
async function landing(res: Response): Promise<URL> {
  const m = (await res.text()).match(/location\.replace\((".*?")\)/)
  return new URL(JSON.parse(m![1]))
}

beforeEach(() => {
  vi.clearAllMocks()
  creds.clear()
  Object.assign(process.env, { CRON_SECRET: 'test-cron-secret-at-least-32-bytes!!!!', META_APP_ID: 'platform-app', META_APP_SECRET: 'platform-secret' })
  delete process.env.META_GRAPH_VERSION
  creds.set('t-acme:meta_app', { config_enc: `enc:${JSON.stringify(OWN)}`, status: 'connected', meta: { app_id: OWN.appId }, expires_at: null })
})

describe("Social sign-in with the store's own Meta app", () => {
  it('opens the own app dialog with its login configuration and puts metaApp: own in the state', async () => {
    const res = await socialConnect(new NextRequest('https://admin-acme.jeffistores.in/api/admin/social/connect/facebook'), {
      params: Promise.resolve({ provider: 'facebook' }),
    })
    const url = new URL(res.headers.get('location')!)
    expect(url.pathname).toBe('/v27.0/dialog/oauth')
    expect(url.searchParams.get('client_id')).toBe(OWN.appId)
    expect(url.searchParams.get('config_id')).toBe(OWN.loginConfigId)
    expect(url.searchParams.get('scope')).toBeNull()
    expect(stateOf(res.headers.get('location')!)).toMatchObject({ tenantId: 't-acme', provider: 'facebook', metaApp: 'own' })
  })

  it('exchanges the code with the same own app and saves the only Page with the Facebook user', async () => {
    graph([{ id: '111', name: 'Acme', access_token: 'ptok', instagram_business_account: { id: '222' } }])
    const connect = await socialConnect(new NextRequest('https://x/api/admin/social/connect/facebook'), {
      params: Promise.resolve({ provider: 'facebook' }),
    })
    const state = new URL(connect.headers.get('location')!).searchParams.get('state')!
    const back = await landing(await socialCallback(new NextRequest(`https://admin.jeffistores.in/api/admin/social/callback?state=${state}&code=c1`)))
    expect(back.toString()).toBe('https://admin-acme.jeffistores.in/admin/social-posts?connected=meta')
    expect(tokenCalls().map(u => [u.searchParams.get('client_id'), u.searchParams.get('client_secret')])).toEqual([
      [OWN.appId, OWN.appSecret],
      [OWN.appId, OWN.appSecret],
    ])
    const saved = vi.mocked(saveTenantSocialAccount).mock.calls.map(c => c[0])
    expect(saved.map(s => s.provider)).toEqual(['facebook', 'instagram'])
    expect(saved[0]).toMatchObject({ tenantId: 't-acme', pageId: '111', fbUserId: 'fbu-9', grantedScopes: ['pages_show_list'] })
  })

  it('keeps the sign-in for the Page picker when the user manages two Pages', async () => {
    graph([
      { id: '111', name: 'Acme', access_token: 'p1' },
      { id: '333', name: 'Acme Outlet', access_token: 'p2' },
    ])
    const back = await landing(
      await socialCallback(
        new NextRequest(`https://admin.jeffistores.in/api/admin/social/callback?state=${await ownState('facebook')}&code=c1`)
      )
    )
    expect(back.searchParams.get('pick')).toBe('1')
    expect(saveTenantSocialAccount).not.toHaveBeenCalled()
    const pending = JSON.parse(creds.get('t-acme:meta_page_pick')!.config_enc.replace(/^enc:/, ''))
    expect(pending).toMatchObject({ userToken: 'long', fbUserId: 'fbu-9', metaApp: 'own' })
  })

  it('uses the platform app when the state says so, even though the store now has its own', async () => {
    graph([{ id: '111', name: 'Acme', access_token: 'ptok' }])
    const { signAdminState } = await import('@/lib/shared/oauth-state')
    const state = signAdminState({ tenantId: 't-acme', provider: 'facebook', nonce: 'n', metaApp: 'platform' })
    await socialCallback(new NextRequest(`https://admin.jeffistores.in/api/admin/social/callback?state=${state}&code=c1`))
    expect(tokenCalls()[0].searchParams.get('client_id')).toBe('platform-app')
  })
})

describe("Meta Ads sign-in with the store's own Meta app", () => {
  it('signs in and exchanges the code with the own app', async () => {
    graph([])
    const connect = await adsConnect(new NextRequest('https://admin-acme.jeffistores.in/api/admin/integrations/meta-ads/connect'))
    const url = new URL(connect.headers.get('location')!)
    expect(url.searchParams.get('client_id')).toBe(OWN.appId)
    expect(url.searchParams.get('scope')).toBe('ads_read,ads_management,business_management')
    expect(stateOf(url.toString())).toMatchObject({ provider: 'meta_ads', metaApp: 'own' })

    const back = await landing(
      await adsCallback(
        new NextRequest(`https://admin.jeffistores.in/api/admin/integrations/meta-ads/callback?state=${url.searchParams.get('state')}&code=c2`)
      )
    )
    expect(back.searchParams.get('pick')).toBe('1')
    expect(tokenCalls().every(u => u.searchParams.get('client_id') === OWN.appId)).toBe(true)
    expect(creds.get('t-acme:meta_ads')!.meta).toMatchObject({ fb_user_id: 'fbu-9' })
  })
})

async function ownState(provider: string) {
  const { signAdminState } = await import('@/lib/shared/oauth-state')
  return signAdminState({ tenantId: 't-acme', provider, nonce: 'n', metaApp: 'own' })
}
