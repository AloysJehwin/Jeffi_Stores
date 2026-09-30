import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockResolveTenant, mockVerifyToken } = vi.hoisted(() => ({
  mockResolveTenant: vi.fn(),
  mockVerifyToken: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  verifyToken: mockVerifyToken,
  verifyBusinessToken: vi.fn(),
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/scopes', () => ({
  getScopeForPath: vi.fn().mockReturnValue(null),
  hasScope: vi.fn().mockReturnValue(true),
  isPlatformAdmin: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/auth-sessions', () => ({ resolveSession: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/tenant-mtls', () => ({
  decodeClientCertHeader: vi.fn().mockReturnValue('pem'),
  verifyTenantClientCert: vi.fn().mockResolvedValue({ ok: true, serial: 'AB', commonName: 'owner' }),
}))
vi.mock('@/lib/tenant-registry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tenant-registry')>('@/lib/tenant-registry')
  return { ...actual, resolveTenantFromHost: mockResolveTenant }
})

import { middleware } from '@/middleware'
import { adminCookieNameForHost } from '@/lib/admin-cookie'

const ACTIVE = {
  tenantId: 't-1',
  slug: 'acme',
  displayName: 'Acme',
  plan: 'basic',
  infra: {
    rdsEndpoint: 'ep',
    rdsDb: 'jeffi_stores',
    rdsPort: 5432,
    dbSecretRef: null,
    iamAuth: true,
    s3Bucket: 'b',
    region: 'us-east-1',
  },
}

// Next encodes request-header mutations onto the response as x-middleware-request-*.
function forwardedTenantSlug(res: Response): string | null {
  return res.headers.get('x-middleware-request-x-tenant-slug')
}

function req(url: string, host: string, opts: { admin?: boolean } = {}) {
  const r = new NextRequest(url, {
    headers: new Headers({ host, 'x-forwarded-host': host, 'x-client-cert': 'pem' }),
  })
  if (opts.admin) r.cookies.set(adminCookieNameForHost(host), 'deadbeef')
  return r
}

describe('every tenant-host exit forwards x-tenant-slug to the request', () => {
  beforeEach(() => {
    mockResolveTenant.mockReset()
    mockResolveTenant.mockResolvedValue(ACTIVE)
    mockVerifyToken.mockReset()
    mockVerifyToken.mockResolvedValue({ adminId: 'a-1', role: 'admin', scopes: [], email: 'a@acme.test' })
  })

  it('forwards it on the tenant storefront catch-all', async () => {
    const res = await middleware(req('https://acme.jeffistores.in/', 'acme.jeffistores.in'))
    expect(forwardedTenantSlug(res)).toBe('acme')
  })

  it('forwards it on the tenant admin API path', async () => {
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/api/admin/products', 'admin-acme.jeffistores.in', { admin: true })
    )
    expect(forwardedTenantSlug(res)).toBe('acme')
  })

  it('forwards it on a public admin API path', async () => {
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/api/admin/auth/email-otp/start', 'admin-acme.jeffistores.in')
    )
    expect(forwardedTenantSlug(res)).toBe('acme')
  })

  it('forwards it on the tenant admin subdomain rewrite', async () => {
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/products', 'admin-acme.jeffistores.in', { admin: true })
    )
    expect(forwardedTenantSlug(res)).toBe('acme')
  })

  it('sets no tenant slug on platform hosts', async () => {
    mockResolveTenant.mockResolvedValue(null)
    for (const host of ['jeffistores.in', 'admin.jeffistores.in', 'ecom.jeffistores.in']) {
      const res = await middleware(req(`https://${host}/`, host))
      expect(forwardedTenantSlug(res), host).toBeNull()
    }
  })
})

// The cert badge reads x-client-cert-cn, but check-session sits in the public-API allowlist,
// which returned before the mTLS block ran — so the header never arrived and the panel
// reported "not detected" however valid the certificate was.
describe('a verified client certificate reaches the routes that read it', () => {
  beforeEach(() => {
    mockResolveTenant.mockReset()
    mockResolveTenant.mockResolvedValue(ACTIVE)
    mockVerifyToken.mockReset()
    mockVerifyToken.mockResolvedValue({ adminId: 'a-1', role: 'admin', scopes: [], email: 'a@acme.test' })
  })

  const cn = (res: Response) => res.headers.get('x-middleware-request-x-client-cert-cn')

  it('forwards the verified CN to check-session', async () => {
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/api/admin/check-session', 'admin-acme.jeffistores.in')
    )
    expect(cn(res)).toBe('owner')
  })

  it('forwards it to the login OTP endpoint', async () => {
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/api/admin/auth/email-otp/start', 'admin-acme.jeffistores.in')
    )
    expect(cn(res)).toBe('owner')
  })

  it('forwards it on a normal admin page', async () => {
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/products', 'admin-acme.jeffistores.in', { admin: true })
    )
    expect(cn(res)).toBe('owner')
  })
})
