import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockResolveTenant } = vi.hoisted(() => ({ mockResolveTenant: vi.fn() }))

vi.mock('@/lib/jwt', () => ({
  verifyToken: vi.fn(),
  verifyBusinessToken: vi.fn(),
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/scopes', () => ({
  getScopeForPath: vi.fn().mockReturnValue(null),
  hasScope: vi.fn().mockReturnValue(true),
  isPlatformAdmin: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/tenant-registry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tenant-registry')>('@/lib/tenant-registry')
  return { ...actual, resolveTenantFromHost: mockResolveTenant }
})

import { middleware } from '@/middleware'

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers: new Headers(headers) })
}

const ACTIVE = {
  tenantId: 't-1',
  slug: 'acme',
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

describe('unknown tenant host must 404, never fall through to the platform store', () => {
  beforeEach(() => {
    mockResolveTenant.mockReset()
  })

  it('404s an unresolved tenant slug instead of serving the flagship', async () => {
    mockResolveTenant.mockResolvedValue(null)
    const res = await middleware(req('https://nope.jeffistores.in/', { 'x-forwarded-host': 'nope.jeffistores.in' }))
    expect(res.status).toBe(404)
  })

  it('404s an unresolved tenant admin host rather than offering a login page', async () => {
    mockResolveTenant.mockResolvedValue(null)
    const res = await middleware(
      req('https://admin-nope.jeffistores.in/', { 'x-forwarded-host': 'admin-nope.jeffistores.in' })
    )
    expect(res.status).toBe(404)
  })

  it('404s an unknown custom domain', async () => {
    mockResolveTenant.mockResolvedValue(null)
    const res = await middleware(req('https://shop.example.com/', { 'x-forwarded-host': 'shop.example.com' }))
    expect(res.status).toBe(404)
  })

  it('does NOT 404 the platform apex', async () => {
    mockResolveTenant.mockResolvedValue(null)
    const res = await middleware(req('https://jeffistores.in/', { 'x-forwarded-host': 'jeffistores.in' }))
    expect(res.status).not.toBe(404)
  })

  it('does NOT 404 reserved platform subdomains', async () => {
    mockResolveTenant.mockResolvedValue(null)
    for (const h of ['admin.jeffistores.in', 'ecom.jeffistores.in', 'forms.jeffistores.in']) {
      const res = await middleware(req(`https://${h}/`, { 'x-forwarded-host': h }))
      expect(res.status, h).not.toBe(404)
    }
  })

  it('serves a resolved tenant and forwards x-tenant-slug', async () => {
    mockResolveTenant.mockResolvedValue(ACTIVE)
    const res = await middleware(req('https://acme.jeffistores.in/', { 'x-forwarded-host': 'acme.jeffistores.in' }))
    expect(res.status).not.toBe(404)
  })
})

describe('x-forwarded-host spoofing guard', () => {
  beforeEach(() => {
    mockResolveTenant.mockReset()
    mockResolveTenant.mockResolvedValue(null)
  })

  it('ignores a forwarded host that disagrees with Host on the tenant slug', async () => {
    // Host says platform apex; forged forwarded header claims a tenant.
    await middleware(
      req('https://jeffistores.in/', {
        host: 'jeffistores.in',
        'x-forwarded-host': 'victim.jeffistores.in',
      })
    )
    // The guard must have resolved the platform host, never the forged tenant.
    const seen = mockResolveTenant.mock.calls.map(c => c[0])
    expect(seen).not.toContain('victim.jeffistores.in')
  })

  it('accepts a forwarded host that agrees with Host', async () => {
    await middleware(
      req('https://acme.jeffistores.in/', {
        host: 'acme.jeffistores.in',
        'x-forwarded-host': 'acme.jeffistores.in',
      })
    )
    expect(mockResolveTenant.mock.calls[0]?.[0]).toBe('acme.jeffistores.in')
  })
})
