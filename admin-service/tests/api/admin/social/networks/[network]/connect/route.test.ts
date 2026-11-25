import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ currentAdminBaseUrlAsync: vi.fn() }))
vi.mock('@/lib/shared/oauth-state', () => ({ signAdminState: vi.fn() }))
vi.mock('@/lib/integrations/owner', () => ({ credentialOwnerId: vi.fn() }))
vi.mock('@/lib/integrations/own-apps', () => ({ NETWORK_APP_FAMILY: { x: 'x' }, resolveOAuthApp: vi.fn() }))
vi.mock('@/lib/social/providers', () => ({ NETWORKS: ['x', 'pinterest'], providerFor: vi.fn() }))
vi.mock('@/lib/social/oauth', () => ({ pkceChallenge: vi.fn(), pkceVerifier: vi.fn(), socialRedirectUri: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/social/networks/[network]/connect/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentAdminBaseUrlAsync } from '@/lib/catalog/brand'
import { signAdminState } from '@/lib/shared/oauth-state'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { resolveOAuthApp } from '@/lib/integrations/own-apps'
import { providerFor } from '@/lib/social/providers'
import { pkceChallenge, pkceVerifier, socialRedirectUri } from '@/lib/social/oauth'

const BACK = 'https://admin.test/admin/social-posts?tab=accounts'
const req = () => new NextRequest('http://localhost/api/admin/social/networks/x/connect')
const ctx = (network: string) => ({ params: Promise.resolve({ network }) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const authorizeUrl = vi.fn()
const oldSecret = process.env.CRON_SECRET

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'secret'
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(currentAdminBaseUrlAsync).mockResolvedValue('https://admin.test')
  vi.mocked(credentialOwnerId).mockResolvedValue('t1' as any)
  vi.mocked(providerFor).mockReturnValue({ oauth: { authorizeUrl } } as any)
  vi.mocked(resolveOAuthApp).mockResolvedValue({ source: 'own', app: { clientId: 'c' } } as any)
  vi.mocked(signAdminState).mockReturnValue('signed-state')
  vi.mocked(pkceVerifier).mockReturnValue('ver')
  vi.mocked(pkceChallenge).mockReturnValue('chal')
  vi.mocked(socialRedirectUri).mockReturnValue('https://cb')
  authorizeUrl.mockReturnValue('https://network.test/authorize?x=1')
})

afterEach(() => {
  if (oldSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = oldSecret
})

describe('GET /api/admin/social/networks/[network]/connect', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req(), ctx('x'))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req(), ctx('x'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('redirects back with unknown_network for an unsupported network', async () => {
    const res = await GET(req(), ctx('tiktok'))
    expect(res.headers.get('location')).toBe(`${BACK}&connected=0&error=unknown_network`)
  })

  it('redirects back with not_configured when no app or secret is available', async () => {
    vi.mocked(resolveOAuthApp).mockResolvedValue(null as any)
    expect((await GET(req(), ctx('x'))).headers.get('location')).toBe(`${BACK}&connected=0&error=not_configured`)
    vi.mocked(resolveOAuthApp).mockResolvedValue({ source: 'own', app: {} } as any)
    delete process.env.CRON_SECRET
    expect((await GET(req(), ctx('x'))).headers.get('location')).toBe(`${BACK}&connected=0&error=not_configured`)
  })

  it('signs the state and redirects to the network consent screen', async () => {
    const res = await GET(req(), ctx('x'))
    expect(res.headers.get('location')).toBe('https://network.test/authorize?x=1')
    expect(signAdminState).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', provider: 'social:x', returnBase: 'https://admin.test', app: 'own' }))
    expect(authorizeUrl).toHaveBeenCalledWith('https://cb', 'signed-state', 'chal', { clientId: 'c' })
  })
})
