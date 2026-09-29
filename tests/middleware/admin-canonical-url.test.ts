import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockResolveTenant, mockVerifyToken } = vi.hoisted(() => ({
  mockResolveTenant: vi.fn(),
  mockVerifyToken: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  verifyToken: mockVerifyToken, verifyBusinessToken: vi.fn(), authenticateAdmin: vi.fn(),
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
import { ap } from '@/lib/admin-path'

const ACTIVE = {
  tenantId: 't-1', slug: 'acme', displayName: 'Acme', plan: 'basic',
  infra: { rdsEndpoint: 'ep', rdsDb: 'jeffi_stores', rdsPort: 5432, dbSecretRef: null, iamAuth: true, s3Bucket: 'b', region: 'us-east-1' },
}

function req(url: string, host: string, opts: { admin?: boolean } = {}) {
  const r = new NextRequest(url, {
    headers: new Headers({ host, 'x-forwarded-host': host, 'x-client-cert': 'pem' }),
  })
  if (opts.admin) r.cookies.set(adminCookieNameForHost(host), 'deadbeef')
  return r
}

describe('an admin host serves the panel at the root, never under /admin', () => {
  beforeEach(() => {
    mockResolveTenant.mockReset()
    mockResolveTenant.mockResolvedValue(null)
    mockVerifyToken.mockReset()
    mockVerifyToken.mockResolvedValue({ adminId: 'a-1', role: 'admin', scopes: [], email: 'a@x.test' })
  })

  it('redirects /admin/ecom/customers to /ecom/customers, query intact', async () => {
    const res = await middleware(req(
      'https://admin.jeffistores.in/admin/ecom/customers/abc?tab=overview',
      'admin.jeffistores.in',
      { admin: true },
    ))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://admin.jeffistores.in/ecom/customers/abc?tab=overview')
  })

  it('retires /admin/login on a tenant admin host', async () => {
    mockResolveTenant.mockResolvedValue(ACTIVE)
    const res = await middleware(req('https://admin-acme.jeffistores.in/admin/login', 'admin-acme.jeffistores.in'))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://admin-acme.jeffistores.in/login')
  })

  it('leaves /api/admin/* alone', async () => {
    const res = await middleware(req('https://admin.jeffistores.in/api/admin/products', 'admin.jeffistores.in', { admin: true }))
    expect(res.status).not.toBe(308)
  })

  it('does not touch a path merely starting with the letters admin', async () => {
    const res = await middleware(req('https://admin.jeffistores.in/administrators', 'admin.jeffistores.in', { admin: true }))
    expect(res.status).not.toBe(308)
  })
})

describe('ap() strips /admin on both admin host shapes', () => {
  it('strips on the platform admin host', () => {
    expect(ap('/admin/products', 'admin.jeffistores.in')).toBe('/products')
  })

  it('strips on a tenant admin host', () => {
    expect(ap('/admin/products', 'admin-acme.jeffistores.in')).toBe('/products')
  })

  it('keeps the prefix elsewhere', () => {
    expect(ap('/admin/products', 'jeffistores.in')).toBe('/admin/products')
  })

  it('maps a bare /admin to the root', () => {
    expect(ap('/admin', 'admin-acme.jeffistores.in')).toBe('/')
  })
})
