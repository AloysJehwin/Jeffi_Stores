import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const session = vi.hoisted(() => ({ verifyPortalToken: vi.fn(), PORTAL_COOKIE: 'portal' }))
vi.mock('@/lib/auth/portal-session', () => session)
const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/tenant-registry/shared', () => ({ ROOT_DOMAIN: 'jeffistores.in' }))
const cm = vi.hoisted(() => ({ certNeedsMobileCheck: vi.fn(), inCertStore: vi.fn() }))
vi.mock('@controller/lib/auth/cert-mobile', () => cm)
vi.mock('@/lib/auth/admin-mobile', () => ({ maskMobile: (m: string) => `***${m.slice(-2)}` }))

import { GET } from '@controller/app/api/(public)/certportal/certs/route'

const call = (cookie: string | null = 'portal=tok') =>
  GET(new NextRequest('http://localhost/api/certportal/certs', { headers: cookie ? { cookie } : {} }))
const future = new Date(Date.now() + 86_400_000).toISOString()
const past = new Date(Date.now() - 86_400_000).toISOString()
const row = (o: Record<string, unknown>) => ({
  serial: 'S', tenant_id: 't-1', common_name: 'cn', role: 'admin', store_name: 'Acme', expires_at: future, downloaded_at: null, revoked_at: null, ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ADMIN_BASE_URL', '')
  session.verifyPortalToken.mockResolvedValue({ email: 'a@b.co', name: 'Ada' })
  cm.certNeedsMobileCheck.mockReturnValue(false)
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/certportal/certs', () => {
  it('401s when not signed in', async () => {
    session.verifyPortalToken.mockResolvedValue(null)
    expect((await call(null)).status).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns an empty list for an account with no certificates', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await call()
    expect(await res.json()).toEqual({ email: 'a@b.co', name: 'Ada', certs: [] })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][1]).toEqual(['a@b.co'])
  })

  it('derives status and admin host per certificate', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          row({ serial: 'A' }),
          row({ serial: 'B', revoked_at: past }),
          row({ serial: 'C', expires_at: past }),
          row({ serial: 'D', downloaded_at: past }),
          row({ serial: 'P', tenant_id: null, store_name: null }),
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 't-1', slug: 'acme', admin_domain: null }] })
    const { certs } = await (await call()).json()
    expect(certs.map((c: any) => c.status)).toEqual(['available', 'revoked', 'expired', 'downloaded', 'available'])
    expect(certs[0].adminHost).toBe('admin-acme.jeffistores.in')
    expect(certs[4].adminHost).toBe('admin.jeffistores.in')
    expect(certs[0].needsMobile).toBe(false)
  })

  it('prefers a verified own admin domain', async () => {
    query
      .mockResolvedValueOnce({ rows: [row({})] })
      .mockResolvedValueOnce({ rows: [{ id: 't-1', slug: 'acme', admin_domain: 'admin.acme.com' }] })
    expect((await (await call()).json()).certs[0].adminHost).toBe('admin.acme.com')
  })

  it('uses ADMIN_BASE_URL for the platform host', async () => {
    vi.stubEnv('ADMIN_BASE_URL', 'https://admin.custom.test/x')
    query.mockResolvedValueOnce({ rows: [row({ tenant_id: null })] })
    expect((await (await call()).json()).certs[0].adminHost).toBe('admin.custom.test')
  })

  it('flags a downloadable certificate whose admin has no verified mobile', async () => {
    cm.certNeedsMobileCheck.mockReturnValue(true)
    cm.inCertStore.mockResolvedValue({ needsMobile: true, mobileHint: null })
    query.mockResolvedValueOnce({ rows: [row({})] }).mockResolvedValueOnce({ rows: [{ id: 't-1', slug: 'acme', admin_domain: null }] })
    const { certs } = await (await call()).json()
    expect(certs[0]).toMatchObject({ needsMobile: true, mobileHint: null })
  })

  it('treats an unreadable store as needing a mobile', async () => {
    cm.certNeedsMobileCheck.mockReturnValue(true)
    cm.inCertStore.mockRejectedValue(new Error('no db'))
    query.mockResolvedValueOnce({ rows: [row({})] }).mockResolvedValueOnce({ rows: [{ id: 't-1', slug: 'acme', admin_domain: null }] })
    expect((await (await call()).json()).certs[0].needsMobile).toBe(true)
  })
})
