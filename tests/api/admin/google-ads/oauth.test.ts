import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn(), resolveTenantId: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({
  currentAdminBaseUrlAsync: vi.fn(async () => 'https://admin-acme.jeffistores.in'),
  currentAdminBaseUrl: () => 'https://admin.jeffistores.in',
  platformOAuthBaseUrl: () => 'https://admin.jeffistores.in',
}))
vi.mock('@/lib/tenant-registry', () => ({
  getTenant: vi.fn(async (id: string) => (id === 't-acme' ? { slug: 'acme' } : { slug: 'platform' })),
  saveIntegrationCredential: vi.fn(),
  getIntegrationCredential: vi.fn(async () => null),
  deleteIntegrationCredential: vi.fn(),
  controlPlanePool: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))

import { GET as adsConnect } from '@/app/api/(admin)/admin/integrations/google-ads/connect/route'
import { GET as googleCallback } from '@/app/api/(admin)/admin/integrations/google/callback/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { saveIntegrationCredential, getIntegrationCredential } from '@/lib/tenant-registry'
import { signAdminState, verifyAdminState } from '@/lib/shared/oauth-state'
import { oauthProviderInfo, OAUTH_CALLBACK_PATHS } from '@/lib/integrations/oauth'

const PLATFORM = '00000000-0000-0000-0000-000000000000'
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const ENV = {
  CRON_SECRET: 'test-cron-secret-at-least-32-bytes!!!!',
  GOOGLE_OAUTH_CLIENT_ID: 'gcid',
  GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'devtok',
}

const get = (url: string) => new NextRequest(url)
async function landing(res: Response): Promise<URL> {
  const html = await res.text()
  const m = html.match(/location\.replace\((".*?")\)/)
  return new URL(JSON.parse(m![1]))
}
const ADWORDS = 'https://www.googleapis.com/auth/adwords'
const DATAMANAGER = 'https://www.googleapis.com/auth/datamanager'
const tokenOk = (scope = ADWORDS) =>
  new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt-ads', scope }), { status: 200 })

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(process.env, ENV)
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t-acme')
  vi.mocked(currentAdminBaseUrlAsync).mockResolvedValue('https://admin-acme.jeffistores.in')
})

describe('Google Ads connect', () => {
  it('shares the Google redirect URI with Merchant Center', () => {
    expect(OAUTH_CALLBACK_PATHS.google_ads).toBe(OAUTH_CALLBACK_PATHS.google_merchant)
    expect(oauthProviderInfo('google_ads').redirectUri).toBe('https://admin.jeffistores.in/api/admin/integrations/google/callback')
  })

  it('requires google_ads:write', async () => {
    await adsConnect(get('https://admin-acme.jeffistores.in/api/admin/integrations/google-ads/connect'))
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
  })

  it('asks Google for the adwords and datamanager scopes, incrementally and offline, with a signed tenant state', async () => {
    const res = await adsConnect(get('https://admin-acme.jeffistores.in/api/admin/integrations/google-ads/connect'))
    const url = new URL(res.headers.get('location')!)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe(`${ADWORDS} ${DATAMANAGER}`)
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('redirect_uri')).toBe('https://admin.jeffistores.in/api/admin/integrations/google/callback')
    const state = verifyAdminState(url.searchParams.get('state')!)
    expect(state).toMatchObject({ tenantId: 't-acme', provider: 'google_ads' })
    expect(state?.keepAccount).toBeUndefined()
  })

  it('marks a reconnect so the chosen account is kept', async () => {
    const res = await adsConnect(get('https://admin-acme.jeffistores.in/api/admin/integrations/google-ads/connect?reconnect=1'))
    const state = verifyAdminState(new URL(res.headers.get('location')!).searchParams.get('state')!)
    expect(state).toMatchObject({ tenantId: 't-acme', provider: 'google_ads', keepAccount: true })
  })

  it('keys the flagship to the platform sentinel', async () => {
    vi.mocked(resolveTenantId).mockResolvedValue(null)
    vi.mocked(currentAdminBaseUrlAsync).mockResolvedValue('https://admin.jeffistores.in')
    const res = await adsConnect(get('https://admin.jeffistores.in/api/admin/integrations/google-ads/connect'))
    const state = verifyAdminState(new URL(res.headers.get('location')!).searchParams.get('state')!)
    expect(state?.tenantId).toBe(PLATFORM)
  })

  it('returns to the page when the platform has no developer token', async () => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    const res = await adsConnect(get('https://admin-acme.jeffistores.in/api/admin/integrations/google-ads/connect'))
    expect(res.headers.get('location')).toBe(
      'https://admin-acme.jeffistores.in/admin/google-ads?connected=0&provider=google_ads&error=not_configured'
    )
  })
})

describe('shared Google callback, Google Ads leg', () => {
  const state = (tenantId = 't-acme') => signAdminState({ tenantId, provider: 'google_ads', nonce: 'n' })

  it('stores the refresh token as a pending google_ads credential and asks to pick an account', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk())
    const res = await googleCallback(get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?code=c1&state=${state()}`))
    const to = await landing(res)
    expect(to.toString()).toBe('https://admin-acme.jeffistores.in/admin/google-ads?connected=google_ads&pick=1')
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(body.get('redirect_uri')).toBe('https://admin.jeffistores.in/api/admin/integrations/google/callback')
    const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(saved).toMatchObject({ tenantId: 't-acme', provider: 'google_ads' })
    expect(JSON.parse(saved.configEnc.replace(/^enc:/, ''))).toEqual({ connected_via: 'oauth', oauth_refresh_token: 'rt-ads', scopes: [ADWORDS] })
    expect(saved.meta).toMatchObject({ needs_customer: true, connected_via: 'oauth', data_manager: false })
  })

  it('records the Data Manager grant for conversion uploads', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk(`${ADWORDS} ${DATAMANAGER}`))
    await googleCallback(get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?code=c1&state=${state()}`))
    const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
    expect(JSON.parse(saved.configEnc.replace(/^enc:/, '')).scopes).toEqual([ADWORDS, DATAMANAGER])
    expect(saved.meta).toMatchObject({ data_manager: true, data_manager_at: expect.any(String) })
  })

  describe('reconnect', () => {
    const reconnect = () => signAdminState({ tenantId: 't-acme', provider: 'google_ads', nonce: 'n', keepAccount: true })
    const stored = (cfg: Record<string, unknown>) =>
      vi.mocked(getIntegrationCredential).mockResolvedValueOnce({ status: 'connected', config_enc: `enc:${JSON.stringify(cfg)}`, meta: {} } as any)
    const customerRow = new Response(
      JSON.stringify([{ results: [{ customer: { id: '1234567890', descriptiveName: 'Acme', manager: false, currencyCode: 'INR' } }] }]),
      { status: 200 }
    )

    it('keeps the account when the new sign-in can still read it and returns to Conversions', async () => {
      stored({ connected_via: 'oauth', oauth_refresh_token: 'old', customer_id: '1234567890', login_customer_id: '5556667778' })
      fetchMock
        .mockResolvedValueOnce(tokenOk(`${ADWORDS} ${DATAMANAGER}`))
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at2', expires_in: 3600 }), { status: 200 }))
        .mockResolvedValueOnce(customerRow)
      const res = await googleCallback(get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?code=c1&state=${reconnect()}`))
      expect((await landing(res)).toString()).toBe('https://admin-acme.jeffistores.in/admin/google-ads?connected=google_ads&tab=conversions')
      const search = fetchMock.mock.calls[2]
      expect(String(search[0])).toContain('/customers/1234567890/googleAds:searchStream')
      expect(search[1].headers['login-customer-id']).toBe('5556667778')
      const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
      expect(JSON.parse(saved.configEnc.replace(/^enc:/, ''))).toEqual({
        connected_via: 'oauth',
        oauth_refresh_token: 'rt-ads',
        customer_id: '1234567890',
        login_customer_id: '5556667778',
        scopes: [ADWORDS, DATAMANAGER],
      })
      expect(saved.meta).toMatchObject({ account_name: 'Acme', data_manager: true, needs_customer: false })
    })

    it('falls back to picking an account when the new sign-in cannot read the old one', async () => {
      stored({ connected_via: 'oauth', oauth_refresh_token: 'old', customer_id: '1234567890' })
      fetchMock
        .mockResolvedValueOnce(tokenOk(`${ADWORDS} ${DATAMANAGER}`))
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at2', expires_in: 3600 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } }), { status: 403 }))
      const res = await googleCallback(get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?code=c1&state=${reconnect()}`))
      expect((await landing(res)).searchParams.get('pick')).toBe('1')
      const saved = vi.mocked(saveIntegrationCredential).mock.calls[0][0]
      expect(JSON.parse(saved.configEnc.replace(/^enc:/, ''))).toEqual({ connected_via: 'oauth', oauth_refresh_token: 'rt-ads', scopes: [ADWORDS, DATAMANAGER] })
    })

    it('does not touch a manager-managed connection', async () => {
      stored({ connected_via: 'manager', customer_id: '1234567890' })
      fetchMock.mockResolvedValueOnce(tokenOk(`${ADWORDS} ${DATAMANAGER}`))
      const res = await googleCallback(get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?code=c1&state=${reconnect()}`))
      expect((await landing(res)).searchParams.get('pick')).toBe('1')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('never touches the Merchant credential', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk())
    await googleCallback(get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?code=c1&state=${state()}`))
    expect(vi.mocked(saveIntegrationCredential).mock.calls.every(c => c[0].provider === 'google_ads')).toBe(true)
  })

  it('sends the flagship back to the platform admin', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk())
    const res = await googleCallback(get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?code=c1&state=${state(PLATFORM)}`))
    expect((await landing(res)).origin).toBe('https://admin.jeffistores.in')
    expect(vi.mocked(saveIntegrationCredential).mock.calls[0][0].tenantId).toBe(PLATFORM)
  })

  it('rejects a token without the adwords scope', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk('https://www.googleapis.com/auth/content'))
    const res = await googleCallback(get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?code=c1&state=${state()}`))
    expect((await landing(res)).searchParams.get('error')).toBe('scope_not_granted')
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('returns a cancelled consent to the Google Ads page', async () => {
    const res = await googleCallback(get(`https://admin.jeffistores.in/api/admin/integrations/google/callback?error=access_denied&state=${state()}`))
    const to = await landing(res)
    expect(to.pathname).toBe('/admin/google-ads')
    expect(to.searchParams.get('error')).toBe('access_denied')
  })

  it('treats a forged state as the Merchant flow and stores nothing', async () => {
    const res = await googleCallback(get('https://admin.jeffistores.in/api/admin/integrations/google/callback?code=c1&state=forged.sig'))
    expect((await landing(res)).searchParams.get('error')).toBe('bad_state')
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })
})
