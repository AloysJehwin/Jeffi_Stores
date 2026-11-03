import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockResolveTenant, mockResolveVaultSid } = vi.hoisted(() => ({
  mockResolveTenant: vi.fn(),
  mockResolveVaultSid: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn(),
  verifyBusinessToken: vi.fn(),
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/shared/rate-limit', () => ({ applyRateLimit: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/tenant-registry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tenant-registry')>('@/lib/tenant-registry')
  return { ...actual, resolveTenantFromHost: mockResolveTenant }
})
vi.mock('@/lib/tenancy/tenant-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tenancy/tenant-context')>('@/lib/tenancy/tenant-context')
  return { ...actual, runWithTenantContext: (_t: unknown, fn: () => unknown) => fn() }
})
const { mockGate } = vi.hoisted(() => ({ mockGate: vi.fn() }))
vi.mock('@/lib/auth/session-binding-gate', () => ({ bindingGate: mockGate }))
vi.mock('@/lib/vault/session', () => ({ resolveVaultSid: mockResolveVaultSid }))

import { middleware } from '@/middleware'

const TENANT = { tenantId: 't-1', slug: 'acme', plan: 'basic', infra: {} }
const HOST = 'vault-acme.jeffistores.in'

function req(path: string, cookie?: string) {
  const r = new NextRequest(`https://${HOST}${path}`, { headers: new Headers({ 'x-forwarded-host': HOST }) })
  if (cookie) r.cookies.set('vault_sid', cookie)
  return r
}

beforeEach(() => {
  mockResolveTenant.mockReset().mockResolvedValue(TENANT)
  mockResolveVaultSid.mockReset()
  mockGate.mockReset().mockReturnValue(null)
})

describe('vault host middleware', () => {
  it('no vault_sid → store handoff carrying the target', async () => {
    const res = await middleware(req('/item/p1'))
    expect(res.status).toBe(307)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.hostname).toBe('acme.jeffistores.in')
    expect(loc.pathname).toBe('/api/vault/handoff')
    expect(loc.searchParams.get('target')).toBe('/item/p1')
    expect(res.headers.get('x-robots-tag')).toContain('noindex')
  })

  it('a .pdf path does not short-circuit as a static asset on the vault host', async () => {
    const res = await middleware(req('/x/file.pdf'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/api/vault/handoff')
  })

  it('rejects a vault session minted for another tenant', async () => {
    mockResolveVaultSid.mockResolvedValue({ userId: 'u1', tenantId: 't-OTHER' })
    const res = await middleware(req('/library', 'abc'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/api/vault/handoff')
  })

  it('valid session → rewrite to /vault{path} with noindex', async () => {
    mockResolveVaultSid.mockResolvedValue({ userId: 'u1', tenantId: 't-1' })
    const res = await middleware(req('/library', 'abc'))
    expect(res.headers.get('x-middleware-rewrite')).toContain('/vault/library')
    expect(res.headers.get('x-robots-tag')).toContain('noindex')
  })

  it('a vault_sid is kept inside the ECDSA binding gate', async () => {
    const { NextResponse } = await import('next/server')
    mockGate.mockReturnValueOnce(new NextResponse('rebind', { status: 200 }))
    const res = await middleware(req('/library', 'abc'))
    expect(await res.text()).toBe('rebind')
    expect(mockGate.mock.calls[0][2]).toBe('vault')
  })

  it('/callback is reachable without a session', async () => {
    const res = await middleware(req('/callback?t=' + 'a'.repeat(64)))
    expect(res.headers.get('x-middleware-rewrite')).toContain('/vault/callback')
    expect(mockResolveVaultSid).not.toHaveBeenCalled()
  })

  it('the /vault route group 404s on the store host', async () => {
    const res = await middleware(
      new NextRequest('https://acme.jeffistores.in/vault/library', {
        headers: new Headers({ 'x-forwarded-host': 'acme.jeffistores.in' }),
      })
    )
    expect(res.status).toBe(404)
  })
})
