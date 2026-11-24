import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/integrations/owner', () => ({ credentialOwnerId: vi.fn(), isPlatformOwner: vi.fn() }))
vi.mock('@/lib/integrations/oauth', () => ({ oauthRedirectUri: vi.fn((p: string) => `https://app/cb/${p}`) }))
vi.mock('@/lib/social/oauth', () => ({ SOCIAL_CALLBACK_PATH: '/social/cb' }))
vi.mock('@/lib/catalog/brand', () => ({ platformOAuthBaseUrl: vi.fn(() => 'https://platform') }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn((r: Request) => r.json().catch(() => null)) }))
vi.mock('@/lib/integrations/own-apps', () => ({
  deleteOwnApp: vi.fn(),
  isOwnAppFamily: vi.fn((f: string) => ['google', 'amazon_seller', 'amazon_ads', 'pinterest'].includes(f)),
  OWN_APP_LABEL: { google: 'Google', amazon_seller: 'Amazon Seller', amazon_ads: 'Amazon Ads', pinterest: 'Pinterest' },
  platformApp: vi.fn(),
  platformDefaultApp: vi.fn(),
  readOwnApp: vi.fn(),
  saveOwnApp: vi.fn(),
}))

import { GET, POST, DELETE } from '@admin/app/api/(admin)/admin/integrations/oauth-app/[family]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { credentialOwnerId, isPlatformOwner } from '@/lib/integrations/owner'
import { deleteOwnApp, platformApp, platformDefaultApp, readOwnApp, saveOwnApp } from '@/lib/integrations/own-apps'

const ctx = (family: string) => ({ params: Promise.resolve({ family }) })
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/x', { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('integrations/oauth-app/[family]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'owner', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(credentialOwnerId).mockResolvedValue('t1' as any)
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    vi.mocked(readOwnApp).mockResolvedValue(null)
  })

  it('404s for an unknown family before any auth', async () => {
    expect((await GET(req('GET'), ctx('myspace'))).status).toBe(404)
    expect(requireAdminScope).not.toHaveBeenCalled()
  })

  it('relays an auth rejection and 403s without a matching scope (read vs write)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await GET(req('GET'), ctx('google'))).status).toBe(401)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req('POST', {}), ctx('amazon_ads'))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('owner', [], 'amazon_ads:write')
    expect((await GET(req('GET'), ctx('amazon_ads'))).status).toBe(403)
    expect(hasScope).toHaveBeenLastCalledWith('owner', [], 'amazon_ads:read')
    expect((await DELETE(req('DELETE'), ctx('amazon_ads'))).status).toBe(403)
  })

  it('GET never returns the secret and lists redirect URIs', async () => {
    vi.mocked(readOwnApp).mockResolvedValue({ clientId: 'cid', clientSecret: 'topsecret', applicationId: 'amzn1.sp.solution.x' } as any)
    vi.mocked(platformDefaultApp).mockResolvedValue({ clientId: 'p' } as any)
    const j = await (await GET(req('GET'), ctx('google'))).json()
    expect(j).toMatchObject({ family: 'google', label: 'Google', own: true, clientId: 'cid', platformReady: true, isPlatform: false })
    expect(j.redirectUris).toEqual(['https://app/cb/google_merchant', 'https://platform/social/cb'])
    expect(JSON.stringify(j)).not.toContain('topsecret')
  })

  it('GET reports platform env readiness for the platform owner', async () => {
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    vi.mocked(platformApp).mockReturnValue(null as any)
    const j = await (await GET(req('GET'), ctx('pinterest'))).json()
    expect(j).toMatchObject({ platformReady: false, isPlatform: true, own: false })
  })

  it('POST 400s on bad input, a missing secret and a bad Amazon app id', async () => {
    expect((await POST(req('POST', { clientId: 'ab' }), ctx('google'))).status).toBe(400)
    expect((await POST(req('POST', { clientId: 'client-1' }), ctx('google'))).status).toBe(400)
    expect((await POST(req('POST', { clientId: 'client-1', clientSecret: 's', applicationId: 'nope' }), ctx('amazon_seller'))).status).toBe(400)
    expect(saveOwnApp).not.toHaveBeenCalled()
  })

  it('POST saves the app, or keeps the saved secret for the same client id', async () => {
    const res = await POST(req('POST', { clientId: 'client-1', clientSecret: 'sec' }), ctx('google'))
    expect(await res.json()).toEqual({ ok: true, own: true, clientId: 'client-1' })
    expect(saveOwnApp).toHaveBeenCalledWith('t1', 'google', { clientId: 'client-1', clientSecret: 'sec' })
    vi.mocked(readOwnApp).mockResolvedValue({ clientId: 'client-1', clientSecret: 'old' } as any)
    await POST(req('POST', { clientId: 'client-1', clientSecret: '' }), ctx('google'))
    expect(saveOwnApp).toHaveBeenLastCalledWith('t1', 'google', { clientId: 'client-1', clientSecret: 'old' })
  })

  it('POST accepts an Amazon seller app id', async () => {
    await POST(req('POST', { clientId: 'client-1', clientSecret: 's', applicationId: 'amzn1.sp.solution.abc' }), ctx('amazon_seller'))
    expect(saveOwnApp).toHaveBeenCalledWith('t1', 'amazon_seller', expect.objectContaining({ applicationId: 'amzn1.sp.solution.abc' }))
  })

  it('DELETE falls back to the platform app', async () => {
    expect(await (await DELETE(req('DELETE'), ctx('google'))).json()).toEqual({ ok: true, own: false })
    expect(deleteOwnApp).toHaveBeenCalledWith('t1', 'google')
  })
})
