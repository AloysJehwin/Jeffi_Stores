import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockOwner, mockTenants } = vi.hoisted(() => ({ mockOwner: vi.fn(), mockTenants: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: mockOwner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/auth/cookie-domain', () => ({ cookieDomainOption: () => ({ domain: '.jeffistores.in' }) }))
vi.mock('@/lib/tenant-registry', () => ({ getOwnerTenants: mockTenants }))
vi.mock('@controller/lib/ecom/owner-context', () => ({ TENANT_COOKIE: 'jeffi_tenant' }))

import { POST } from '@controller/app/api/(ecom)/ecom/tenant/select/route'

const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/tenant/select', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('POST /api/ecom/tenant/select', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwner.mockResolvedValue({ id: 'o-1' })
    mockTenants.mockResolvedValue([{ id: 't-1', slug: 'acme' }])
  })

  it('401s without a session', async () => {
    mockOwner.mockResolvedValue(null)
    expect((await POST(req({ slug: 'acme' }))).status).toBe(401)
  })

  it('400s a missing slug and 404s a store the owner does not have', async () => {
    expect((await POST(req({}))).status).toBe(400)
    const res = await POST(req({ slug: 'other' }))
    expect(res.status).toBe(404)
    expect(res.cookies.get('jeffi_tenant')).toBeUndefined()
  })

  it("remembers the owner's store in a cookie", async () => {
    const res = await POST(req({ slug: 'acme' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockTenants).toHaveBeenCalledWith('o-1')
    const c = res.cookies.get('jeffi_tenant')
    expect(c?.value).toBe('acme')
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 })
  })

  it('lets a lookup failure propagate', async () => {
    mockTenants.mockRejectedValue(new Error('db down'))
    await expect(POST(req({ slug: 'acme' }))).rejects.toThrow('db down')
  })
})
