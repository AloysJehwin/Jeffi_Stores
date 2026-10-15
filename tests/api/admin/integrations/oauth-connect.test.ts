import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({
  currentAdminBaseUrlAsync: vi.fn(async () => 'https://admin-acme.jeffistores.in'),
  currentAdminBaseUrl: () => 'https://admin.jeffistores.in',
  platformOAuthBaseUrl: () => 'https://admin.jeffistores.in',
}))
vi.mock('@/lib/tenant-registry', () => ({
  getTenant: vi.fn(async () => ({ slug: 'acme' })),
  saveIntegrationCredential: vi.fn(),
  getIntegrationCredential: vi.fn(async () => null),
  saveTenantSocialAccount: vi.fn(),
  deleteTenantSocialAccount: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))
vi.mock('@/lib/catalog/meta', () => ({
  buildOAuthUrl: (redirectUri: string, state: string) =>
    `https://www.facebook.com/dialog/oauth?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
  exchangeCodeForToken: vi.fn(async () => 'short'),
  getLongLivedToken: vi.fn(async () => ({ token: 'long', expiresInSec: 5184000 })),
  getPageAndIgAccounts: vi.fn(async () => ({
    pageId: '111',
    pageName: 'Acme',
    pageAccessToken: 'ptok',
    igUserId: '222',
  })),
}))

import { GET as amazonConnect } from '@/app/api/(admin)/admin/integrations/amazon/connect/route'
import { GET as amazonCallback } from '@/app/api/(admin)/admin/integrations/amazon/callback/route'
import { GET as googleConnect } from '@/app/api/(admin)/admin/integrations/google/connect/route'
import { GET as googleCallback } from '@/app/api/(admin)/admin/integrations/google/callback/route'
import { GET as metaConnect } from '@/app/api/(admin)/admin/social/connect/[provider]/route'
import { GET as metaCallback } from '@/app/api/(admin)/admin/social/callback/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import {
  saveIntegrationCredential,
  saveTenantSocialAccount,
  deleteTenantSocialAccount,
  getIntegrationCredential,
} from '@/lib/tenant-registry'
import { getPageAndIgAccounts, exchangeCodeForToken } from '@/lib/catalog/meta'
import { signAdminState } from '@/lib/shared/oauth-state'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const ENV = {
  CRON_SECRET: 'test-cron-secret-at-least-32-bytes!!!!',
  AMAZON_SP_APP_ID: 'amzn1.sp.solution.app',
  AMAZON_LWA_APP_CLIENT_ID: 'amzn1.application-oa2-client.abc',
  AMAZON_LWA_APP_CLIENT_SECRET: 'lwa-secret',
  GOOGLE_OAUTH_CLIENT_ID: 'gcid',
  GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret',
  META_APP_ID: 'meta-app',
  META_APP_SECRET: 'meta-secret',
}

const get = (url: string) => new NextRequest(url)
const location = (res: Response) => new URL(res.headers.get('location')!)
async function landing(res: Response): Promise<URL> {
  const html = await res.text()
  const m = html.match(/location\.replace\((".*?")\)/)
  return new URL(JSON.parse(m![1]))
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(process.env, ENV)
  delete process.env.AMAZON_SP_APP_DRAFT
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 't-acme', slug: 'acme' } as any)
})

describe('Amazon SP-API connect', () => {
  it('sends the seller to Seller Central India with the SP app id, platform redirect URI and a signed tenant state', async () => {
    const res = await amazonConnect(get('https://admin-acme.jeffistores.in/api/admin/integrations/amazon/connect'))
    const url = location(res)
    expect(url.origin + url.pathname).toBe('https://sellercentral.amazon.in/apps/authorize/consent')
    expect(url.searchParams.get('application_id')).toBe('amzn1.sp.solution.app')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://admin.jeffistores.in/api/admin/integrations/amazon/callback'
    )
    expect(url.searchParams.get('version')).toBeNull()
    const state = JSON.parse(Buffer.from(url.searchParams.get('state')!.split('.')[0], 'base64url').toString())
    expect(state).toMatchObject({ tenantId: 't-acme', provider: 'amazon_seller' })
  })

  it('adds version=beta for a draft app', async () => {
    process.env.AMAZON_SP_APP_DRAFT = 'true'
    const res = await amazonConnect(get('https://x/api/admin/integrations/amazon/connect'))
    expect(location(res).searchParams.get('version')).toBe('beta')
  })

  it('returns the admin to merchant-sync with not_configured when the platform app is missing', async () => {
    delete process.env.AMAZON_SP_APP_ID
    const res = await amazonConnect(get('https://x/api/admin/integrations/amazon/connect'))
    const url = location(res)
    expect(url.host).toBe('admin-acme.jeffistores.in')
    expect(url.searchParams.get('error')).toBe('not_configured')
  })

  it('refuses without an admin session', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await amazonConnect(get('https://x/api/admin/integrations/amazon/connect'))).status).toBe(401)
  })
})

describe('Amazon SP-API callback', () => {
  const cb = (q: string) => get(`https://admin.jeffistores.in/api/admin/integrations/amazon/callback?${q}`)

  it('exchanges the code with the redirect URI, stores the refresh token on the state tenant and returns to that tenant admin', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ refresh_token: 'Atzr|new' }) })
    const state = signAdminState({ tenantId: 't-acme', provider: 'amazon_seller', nonce: 'n' })
    const res = await amazonCallback(cb(`state=${state}&spapi_oauth_code=code1&selling_partner_id=A1SELLER`))
    const back = await landing(res)
    expect(back.toString()).toBe('https://admin-acme.jeffistores.in/admin/merchant-sync?connected=amazon')
    const body = String(fetchMock.mock.calls[0][1].body)
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain(encodeURIComponent('https://admin.jeffistores.in/api/admin/integrations/amazon/callback'))
    const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(saved.tenantId).toBe('t-acme')
    expect(JSON.parse(saved.configEnc.replace(/^enc:/, ''))).toEqual({
      client_id: ENV.AMAZON_LWA_APP_CLIENT_ID,
      client_secret: 'lwa-secret',
      refresh_token: 'Atzr|new',
      seller_id: 'A1SELLER',
      marketplace_id: 'A21TJRUUN4KGV',
    })
    expect(saved.meta).toMatchObject({ connected_via: 'oauth', seller_id: 'A1SELLER' })
  })

  it('keeps the marketplace the tenant set before', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValueOnce({
      config_enc: JSON.stringify({ marketplace_id: 'A1PA6795UKMFR9' }),
    } as any)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ refresh_token: 'Atzr|new' }) })
    const state = signAdminState({ tenantId: 't-acme', provider: 'amazon_seller', nonce: 'n' })
    await amazonCallback(cb(`state=${state}&spapi_oauth_code=c&selling_partner_id=A1`))
    expect(vi.mocked(saveIntegrationCredential).mock.calls[0][0].meta.marketplace_id).toBe('A1PA6795UKMFR9')
  })

  it('rejects a forged state without exchanging anything', async () => {
    const res = await amazonCallback(cb('state=forged.sig&spapi_oauth_code=c'))
    expect((await landing(res)).searchParams.get('error')).toBe('bad_state')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('shows the LWA error when the exchange fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'invalid_grant', error_description: 'code expired' }),
    })
    const state = signAdminState({ tenantId: 't-acme', provider: 'amazon_seller', nonce: 'n' })
    const back = await landing(await amazonCallback(cb(`state=${state}&spapi_oauth_code=c`)))
    expect(back.host).toBe('admin-acme.jeffistores.in')
    expect(back.searchParams.get('error')).toBe('code expired')
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('passes a provider denial back to the tenant admin', async () => {
    const state = signAdminState({ tenantId: 't-acme', provider: 'amazon_seller', nonce: 'n' })
    const back = await landing(await amazonCallback(cb(`state=${state}&error=access_denied`)))
    expect(back.host).toBe('admin-acme.jeffistores.in')
    expect(back.searchParams.get('error')).toBe('access_denied')
  })
})

describe('Google Merchant connect + callback', () => {
  it('needs a numeric merchant id before going to Google', async () => {
    const res = await googleConnect(get('https://x/api/admin/integrations/google/connect?merchant_id=abc'))
    expect(location(res).searchParams.get('error')).toBe('invalid_merchant_id')
  })

  it('asks Google for the content scope offline, with the platform redirect URI and the merchant id in state', async () => {
    const url = location(
      await googleConnect(get('https://x/api/admin/integrations/google/connect?merchant_id=5550001'))
    )
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/content')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://admin.jeffistores.in/api/admin/integrations/google/callback'
    )
    const state = JSON.parse(Buffer.from(url.searchParams.get('state')!.split('.')[0], 'base64url').toString())
    expect(state).toMatchObject({ tenantId: 't-acme', provider: 'google_merchant', merchantId: '5550001' })
  })

  it('stores the refresh token and merchant id on the state tenant', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ refresh_token: 'g-rt', scope: 'https://www.googleapis.com/auth/content' }),
    })
    const state = signAdminState({ tenantId: 't-acme', provider: 'google_merchant', nonce: 'n', merchantId: '5550001' })
    const back = await landing(
      await googleCallback(
        get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?state=${state}&code=c`)
      )
    )
    expect(back.toString()).toBe('https://admin-acme.jeffistores.in/admin/merchant-sync?connected=google')
    const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(JSON.parse(saved.configEnc.replace(/^enc:/, ''))).toEqual({
      oauth_refresh_token: 'g-rt',
      merchant_id: '5550001',
    })
    expect(saved.meta).toEqual({ merchant_id: '5550001', connected_via: 'oauth' })
  })

  it('refuses when the content scope was not granted', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ refresh_token: 'g-rt', scope: 'openid' }) })
    const state = signAdminState({ tenantId: 't-acme', provider: 'google_merchant', nonce: 'n', merchantId: '5550001' })
    const back = await landing(
      await googleCallback(
        get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?state=${state}&code=c`)
      )
    )
    expect(back.searchParams.get('error')).toBe('scope_not_granted')
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('rejects a state minted for another provider', async () => {
    const state = signAdminState({ tenantId: 't-acme', provider: 'amazon_seller', nonce: 'n' })
    const back = await landing(
      await googleCallback(
        get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?state=${state}&code=c`)
      )
    )
    expect(back.searchParams.get('error')).toBe('bad_state')
  })
})

describe('Meta connect + callback', () => {
  it('uses the fixed platform redirect URI, not the tenant admin host', async () => {
    const res = await metaConnect(get('https://admin-acme.jeffistores.in/api/admin/social/connect/facebook'), {
      params: Promise.resolve({ provider: 'facebook' }),
    })
    const url = location(res)
    expect(url.searchParams.get('redirect_uri')).toBe('https://admin.jeffistores.in/api/admin/social/callback')
  })

  it('stores the Page + IG account on the state tenant without needing an admin cookie', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    const state = signAdminState({ tenantId: 't-acme', provider: 'facebook', nonce: 'n' })
    const back = await landing(
      await metaCallback(get(`https://admin.jeffistores.in/api/admin/social/callback?state=${state}&code=c`))
    )
    expect(back.toString()).toBe('https://admin-acme.jeffistores.in/admin/social-posts?connected=meta')
    expect(exchangeCodeForToken).toHaveBeenCalledWith('c', 'https://admin.jeffistores.in/api/admin/social/callback')
    const calls = vi.mocked(saveTenantSocialAccount).mock.calls.map(c => c[0])
    expect(calls.map(c => c.provider)).toEqual(['facebook', 'instagram'])
    expect(calls[1]).toMatchObject({ tenantId: 't-acme', pageId: '111', igUserId: '222', accessTokenEnc: 'enc:ptok' })
  })

  it('drops a stale IG row when the Page no longer has a linked IG account', async () => {
    vi.mocked(getPageAndIgAccounts).mockResolvedValueOnce({
      pageId: '111',
      pageName: 'Acme',
      pageAccessToken: 'p',
      igUserId: null,
    })
    const state = signAdminState({ tenantId: 't-acme', provider: 'facebook', nonce: 'n' })
    await metaCallback(get(`https://admin.jeffistores.in/api/admin/social/callback?state=${state}&code=c`))
    expect(deleteTenantSocialAccount).toHaveBeenCalledWith('t-acme', 'instagram')
  })

  it('shows Meta errors (e.g. no Page) on the tenant admin', async () => {
    vi.mocked(getPageAndIgAccounts).mockRejectedValueOnce(new Error('No Facebook Page found'))
    const state = signAdminState({ tenantId: 't-acme', provider: 'facebook', nonce: 'n' })
    const back = await landing(
      await metaCallback(get(`https://admin.jeffistores.in/api/admin/social/callback?state=${state}&code=c`))
    )
    expect(back.host).toBe('admin-acme.jeffistores.in')
    expect(back.searchParams.get('error')).toBe('No Facebook Page found')
  })
})
