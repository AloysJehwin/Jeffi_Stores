import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/shared/oauth-state', () => ({ verifyAdminState: vi.fn(), returnToAdmin: vi.fn((u: string) => NextResponse.redirect(u)) }))
vi.mock('@/lib/integrations/oauth', () => ({
  oauthRedirectUri: vi.fn(() => 'https://app/cb'),
  tenantAdminBase: vi.fn(async () => 'https://admin.shop.in'),
  errorParam: vi.fn((e: unknown) => String(e instanceof Error ? e.message : e).replace(/\s+/g, '_')),
}))
vi.mock('@/lib/integrations/own-apps', () => ({ appForSource: vi.fn(), appFieldsForTokens: vi.fn(() => ({ app_source: 'own' })) }))
vi.mock('@/lib/amazon-ads/client', () => ({ LWA_TOKEN: 'https://api.amazon.com/auth/o2/token', saveAmazonAdsConfig: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/integrations/amazon-ads/callback/route'
import { verifyAdminState } from '@/lib/shared/oauth-state'
import { appForSource } from '@/lib/integrations/own-apps'
import { saveAmazonAdsConfig } from '@/lib/amazon-ads/client'

const req = (qs: string) => new NextRequest(`http://localhost/api/admin/integrations/amazon-ads/callback${qs}`)
const back = 'https://admin.shop.in/admin/amazon-ads'
const loc = (r: Response) => r.headers.get('location')

describe('GET integrations/amazon-ads/callback', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(verifyAdminState).mockReturnValue({ tenantId: 't1', provider: 'amazon_ads', app: 'own' } as any)
    vi.mocked(appForSource).mockResolvedValue({ clientId: 'cid', clientSecret: 'sec' } as any)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ refresh_token: 'rt' }) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('fails on a provider error from Amazon', async () => {
    expect(loc(await GET(req('?error=access_denied&state=s')))).toBe(`${back}?connected=0&error=access_denied`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails on a missing, forged or wrong-provider state', async () => {
    expect(loc(await GET(req('?code=c')))).toContain('error=bad_state')
    vi.mocked(verifyAdminState).mockReturnValue(null as any)
    expect(loc(await GET(req('?code=c&state=forged')))).toContain('error=bad_state')
    vi.mocked(verifyAdminState).mockReturnValue({ tenantId: 't1', provider: 'google' } as any)
    expect(loc(await GET(req('?code=c&state=s')))).toContain('error=bad_state')
    expect(saveAmazonAdsConfig).not.toHaveBeenCalled()
  })

  it('fails on a missing code or unconfigured app', async () => {
    expect(loc(await GET(req('?state=s')))).toContain('error=missing_params')
    vi.mocked(appForSource).mockResolvedValue(null as any)
    expect(loc(await GET(req('?code=c&state=s')))).toContain('error=not_configured')
  })

  it('exchanges the code and stores the refresh token', async () => {
    const res = await GET(req('?code=abc&state=s'))
    expect(loc(res)).toBe(`${back}?connected=1&pick=1`)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.amazon.com/auth/o2/token')
    expect(Object.fromEntries(init.body)).toEqual({ grant_type: 'authorization_code', code: 'abc', redirect_uri: 'https://app/cb', client_id: 'cid', client_secret: 'sec' })
    expect(saveAmazonAdsConfig).toHaveBeenCalledWith('t1', { refresh_token: 'rt', app_source: 'own', connected_via: 'oauth' })
  })

  it('fails when the exchange is rejected or the fetch throws', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error_description: 'bad code' }) })
    expect(loc(await GET(req('?code=c&state=s')))).toContain('error=bad_code')
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(loc(await GET(req('?code=c&state=s')))).toContain('error=network_down')
    expect(saveAmazonAdsConfig).not.toHaveBeenCalled()
  })
})
