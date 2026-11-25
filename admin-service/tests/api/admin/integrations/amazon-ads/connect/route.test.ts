import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ currentAdminBaseUrlAsync: vi.fn() }))
vi.mock('@/lib/shared/oauth-state', () => ({ signAdminState: vi.fn(() => 'signed-state') }))
vi.mock('@/lib/integrations/oauth', () => ({ oauthRedirectUri: vi.fn(() => 'https://app/cb') }))
vi.mock('@/lib/integrations/own-apps', () => ({ resolveOAuthApp: vi.fn() }))
vi.mock('@/lib/amazon-ads/client', () => ({
  AMAZON_ADS_SCOPE: 'advertising::campaign_management',
  LWA_AUTHORIZE: 'https://www.amazon.com/ap/oa',
  amazonAdsTenantKey: vi.fn(),
}))

import { GET } from '@admin/app/api/(admin)/admin/integrations/amazon-ads/connect/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { resolveOAuthApp } from '@/lib/integrations/own-apps'
import { amazonAdsTenantKey } from '@/lib/amazon-ads/client'

const req = () => new NextRequest('http://localhost/api/admin/integrations/amazon-ads/connect')

describe('GET integrations/amazon-ads/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'secret')
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(currentAdminBaseUrlAsync).mockResolvedValue('https://admin.shop.in')
    vi.mocked(amazonAdsTenantKey).mockResolvedValue('t1' as any)
    vi.mocked(resolveOAuthApp).mockResolvedValue({ source: 'own', app: { clientId: 'cid' } } as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('relays a scope rejection (amazon_ads:write)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon_ads:write')
  })

  it('bounces back with not_configured when no app or CRON_SECRET', async () => {
    vi.mocked(resolveOAuthApp).mockResolvedValue(null as any)
    let res = await GET(req())
    expect(res.headers.get('location')).toBe('https://admin.shop.in/admin/amazon-ads?connected=0&error=not_configured')
    vi.mocked(resolveOAuthApp).mockResolvedValue({ source: 'own', app: { clientId: 'cid' } } as any)
    vi.stubEnv('CRON_SECRET', '')
    res = await GET(req())
    expect(res.headers.get('location')).toContain('error=not_configured')
    expect(signAdminState).not.toHaveBeenCalled()
  })

  it('redirects to Amazon consent with a signed state', async () => {
    const res = await GET(req())
    const u = new URL(res.headers.get('location')!)
    expect(u.origin + u.pathname).toBe('https://www.amazon.com/ap/oa')
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'cid', scope: 'advertising::campaign_management', response_type: 'code', redirect_uri: 'https://app/cb', state: 'signed-state' })
    expect(signAdminState).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', provider: 'amazon_ads', returnBase: 'https://admin.shop.in', app: 'own' }))
  })
})
