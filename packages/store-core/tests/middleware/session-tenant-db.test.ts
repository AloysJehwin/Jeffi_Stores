import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'

const { mockResolveTenant, mockVerifyToken, mockResolveSession, seenTenantIds } = vi.hoisted(() => ({
  mockResolveTenant: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockResolveSession: vi.fn(),
  seenTenantIds: [] as (string | null)[],
}))

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: mockVerifyToken,
  verifyBusinessToken: vi.fn(),
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/shared/rate-limit', () => ({ applyRateLimit: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/auth/scopes', () => ({
  getScopeForPath: vi.fn().mockReturnValue(null),
  hasScope: vi.fn().mockReturnValue(true),
  isPlatformAdmin: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/auth/auth-sessions', () => ({ resolveSession: mockResolveSession }))
vi.mock('@/lib/tenancy/tenant-mtls', () => ({
  decodeClientCertHeader: vi.fn().mockReturnValue('pem'),
  verifyTenantClientCert: vi.fn().mockResolvedValue({ ok: true, serial: 'AB', commonName: 'owner' }),
}))
vi.mock('@/lib/tenant-registry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tenant-registry')>('@/lib/tenant-registry')
  return { ...actual, resolveTenantFromHost: mockResolveTenant }
})

import { middleware } from '@/middleware'
import { adminCookieNameForHost } from '@/lib/auth/admin-cookie'

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

function req(url: string, host: string, opts: { admin?: boolean } = {}) {
  const r = new NextRequest(url, {
    headers: new Headers({ host, 'x-forwarded-host': host, 'x-client-cert': 'pem' }),
  })
  if (opts.admin) r.cookies.set(adminCookieNameForHost(host), 'deadbeef')
  return r
}

describe('middleware resolves sessions against the tenant database', () => {
  beforeEach(() => {
    seenTenantIds.length = 0
    mockResolveTenant.mockReset()
    mockResolveTenant.mockResolvedValue(ACTIVE)
    mockResolveSession.mockReset()
    mockResolveSession.mockResolvedValue(null)
    mockVerifyToken.mockReset()
    mockVerifyToken.mockImplementation(async () => {
      seenTenantIds.push(getCurrentTenant()?.tenantId ?? null)
      return { adminId: 'a-1', role: 'admin', scopes: [], email: 'a@acme.test' }
    })
  })

  it('carries tenant context into the admin API session lookup', async () => {
    await middleware(
      req('https://admin-acme.jeffistores.in/api/admin/products', 'admin-acme.jeffistores.in', { admin: true })
    )
    expect(seenTenantIds).toEqual(['t-1'])
  })

  it('carries tenant context into the admin subdomain rewrite lookup', async () => {
    await middleware(req('https://admin-acme.jeffistores.in/products', 'admin-acme.jeffistores.in', { admin: true }))
    expect(seenTenantIds).toEqual(['t-1'])
  })

  it('leaves platform admin lookups on the platform pool', async () => {
    mockResolveTenant.mockResolvedValue(null)
    await middleware(req('https://admin.jeffistores.in/products', 'admin.jeffistores.in', { admin: true }))
    expect(seenTenantIds).toEqual([null])
  })
})

describe('a session minted for another tenant is refused', () => {
  beforeEach(() => {
    mockResolveTenant.mockReset()
    mockResolveTenant.mockResolvedValue(ACTIVE)
    mockResolveSession.mockReset()
    mockVerifyToken.mockReset()
    mockVerifyToken.mockResolvedValue({ adminId: 'a-1', role: 'admin', scopes: [], email: 'a@acme.test' })
  })

  it('refuses a platform session (tenantId null) on a tenant host', async () => {
    mockResolveSession.mockResolvedValue({
      sid: 's',
      principalType: 'admin',
      principalId: 'a-1',
      tenantId: null,
      scopes: [],
    })
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/products', 'admin-acme.jeffistores.in', { admin: true })
    )
    expect(res.status).toBe(307)
  })

  it('refuses another tenant session on this tenant host', async () => {
    mockResolveSession.mockResolvedValue({
      sid: 's',
      principalType: 'admin',
      principalId: 'a-1',
      tenantId: 't-2',
      scopes: [],
    })
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/products', 'admin-acme.jeffistores.in', { admin: true })
    )
    expect(res.status).toBe(307)
  })

  it('does not clear the shared admin cookie when refusing', async () => {
    mockResolveSession.mockResolvedValue({
      sid: 's',
      principalType: 'admin',
      principalId: 'a-1',
      tenantId: null,
      scopes: [],
    })
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/products', 'admin-acme.jeffistores.in', { admin: true })
    )
    expect(res.headers.get('set-cookie') ?? '').not.toContain('admin_sid=')
  })

  it('admits the tenant own session', async () => {
    mockResolveSession.mockResolvedValue({
      sid: 's',
      principalType: 'admin',
      principalId: 'a-1',
      tenantId: 't-1',
      scopes: [],
    })
    const res = await middleware(
      req('https://admin-acme.jeffistores.in/products', 'admin-acme.jeffistores.in', { admin: true })
    )
    expect(res.status).not.toBe(307)
  })
})
