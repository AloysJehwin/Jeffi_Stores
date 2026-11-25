import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/shared/oauth-state', () => ({ verifyAdminState: vi.fn(), returnToAdmin: vi.fn() }))
vi.mock('@/lib/integrations/oauth', () => ({ tenantAdminBase: vi.fn(), errorParam: vi.fn() }))
vi.mock('@/lib/import/jobs', () => ({ PLATFORM_TENANT_ID: 'platform' }))
vi.mock('@/lib/integrations/own-apps', () => ({
  NETWORK_APP_FAMILY: { x: 'x', gbp: 'google' },
  appFieldsForTokens: vi.fn(),
  appForSource: vi.fn(),
}))
vi.mock('@/lib/social/accounts', () => ({ saveNetworkAccount: vi.fn() }))
vi.mock('@/lib/social/providers', () => ({ NETWORKS: ['x', 'gbp'], providerFor: vi.fn() }))
vi.mock('@/lib/social/oauth', () => ({ pkceVerifier: vi.fn(), socialRedirectUri: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/social/network/callback/route'
import { verifyAdminState, returnToAdmin } from '@/lib/shared/oauth-state'
import { tenantAdminBase, errorParam } from '@/lib/integrations/oauth'
import { appFieldsForTokens, appForSource } from '@/lib/integrations/own-apps'
import { saveNetworkAccount } from '@/lib/social/accounts'
import { providerFor } from '@/lib/social/providers'
import { pkceVerifier, socialRedirectUri } from '@/lib/social/oauth'

const BACK = 'https://admin.test/admin/social-posts?tab=accounts'
const req = (qs: string) => new NextRequest(`http://localhost/api/admin/social/network/callback${qs}`)
const state = { tenantId: 't1', provider: 'social:x', nonce: 'n1', app: 'platform' }
const oauth = { exchange: vi.fn(), listTargets: vi.fn() }
const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: null }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(returnToAdmin).mockImplementation((u: string) => NextResponse.redirect(u))
  vi.mocked(tenantAdminBase).mockResolvedValue('https://admin.test')
  vi.mocked(errorParam).mockImplementation((e: any) => `err_${String(e?.message ?? e)}`)
  vi.mocked(verifyAdminState).mockReturnValue(state as any)
  vi.mocked(providerFor).mockReturnValue({ oauth } as any)
  vi.mocked(appForSource).mockResolvedValue({ clientId: 'cid', clientSecret: 'sec' } as any)
  vi.mocked(appFieldsForTokens).mockReturnValue({} as any)
  vi.mocked(pkceVerifier).mockReturnValue('ver')
  vi.mocked(socialRedirectUri).mockReturnValue('https://cb')
  oauth.exchange.mockResolvedValue(tokens)
  oauth.listTargets.mockResolvedValue([{ id: 'u1', name: 'User' }])
})

const location = (res: Response) => res.headers.get('location')

describe('GET /api/admin/social/network/callback', () => {
  it('redirects with the provider error', async () => {
    const res = await GET(req('?state=s&error=access_denied'))
    expect(location(res)).toBe(`${BACK}&connected=0&error=err_access_denied`)
    expect(saveNetworkAccount).not.toHaveBeenCalled()
  })

  it('fails on a bad state or unknown network', async () => {
    vi.mocked(verifyAdminState).mockReturnValue(null as any)
    expect(location(await GET(req('?state=s&code=c')))).toBe(`${BACK}&connected=0&error=bad_state`)
    vi.mocked(verifyAdminState).mockReturnValue({ ...state, provider: 'social:tiktok' } as any)
    expect(location(await GET(req('?state=s&code=c')))).toBe(`${BACK}&connected=0&error=bad_state`)
  })

  it('fails when the code is missing', async () => {
    expect(location(await GET(req('?state=s')))).toBe(`${BACK}&connected=0&error=missing_params`)
  })

  it('fails when the app is not configured', async () => {
    vi.mocked(appForSource).mockResolvedValue(null as any)
    expect(location(await GET(req('?state=s&code=c')))).toBe(`${BACK}&connected=0&error=not_configured`)
  })

  it('saves the account with its single target chosen', async () => {
    const res = await GET(req('?state=s&code=c'))
    expect(location(res)).toBe(`${BACK}&connected=1&network=x`)
    expect(oauth.exchange).toHaveBeenCalledWith('c', 'https://cb', 'ver', expect.anything())
    expect(saveNetworkAccount).toHaveBeenCalledWith('t1', 'x', tokens, { id: 'u1', name: 'User' })
  })

  it('keeps a portal-saved app with the tokens and maps the platform tenant to null', async () => {
    vi.mocked(verifyAdminState).mockReturnValue({ ...state, tenantId: 'platform' } as any)
    vi.mocked(appFieldsForTokens).mockReturnValue({ client_id: 'cid' } as any)
    await GET(req('?state=s&code=c'))
    expect(saveNetworkAccount).toHaveBeenCalledWith(null, 'x', { ...tokens, extra: { via: 'signin', clientId: 'cid', clientSecret: 'sec' } }, expect.anything())
  })

  it('asks the store to pick when several targets are reachable', async () => {
    oauth.listTargets.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const res = await GET(req('?state=s&code=c'))
    expect(location(res)).toBe(`${BACK}&connected=1&network=x&pick=1`)
    expect(saveNetworkAccount).toHaveBeenCalledWith('t1', 'x', tokens, null)
  })

  it('redirects with the error when the code exchange fails', async () => {
    oauth.exchange.mockRejectedValue(new Error('badcode'))
    expect(location(await GET(req('?state=s&code=c')))).toBe(`${BACK}&connected=0&error=err_badcode`)
    expect(saveNetworkAccount).not.toHaveBeenCalled()
  })
})
