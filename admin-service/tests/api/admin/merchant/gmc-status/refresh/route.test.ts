import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ authenticateAdmin: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: m.authenticateAdmin }))
vi.mock('@/lib/merchant/gmc-status', () => ({ refreshGmcStatusSnapshot: m.refresh }))

import { POST } from '@admin/app/api/(admin)/admin/merchant/gmc-status/refresh/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['merchant_sync:write'] }

// happy-dom drops the forbidden `host` header, so the request's header reads are overridden.
function req(overrides: Record<string, string | null> = {}) {
  const r = new NextRequest('https://acme.jeffistores.in/api/admin/merchant/gmc-status/refresh', { method: 'POST' })
  const headers: Record<string, string | null> = { host: 'acme.jeffistores.in', origin: 'https://acme.jeffistores.in', 'x-requested-with': 'jeffi-admin', ...overrides }
  const original = r.headers.get.bind(r.headers)
  Object.defineProperty(r, 'headers', { value: { get: (n: string) => (n.toLowerCase() in headers ? headers[n.toLowerCase()] : original(n)) }, writable: false })
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticateAdmin.mockResolvedValue(ADMIN)
  m.refresh.mockResolvedValue({ products: 300, disapproved: 4 })
})

describe('merchant gmc-status refresh route', () => {
  it('rejects a cross-origin request and a missing CSRF header with 403', async () => {
    expect((await POST(req({ origin: 'https://evil.example', referer: null }))).status).toBe(403)
    expect((await POST(req({ 'x-requested-with': null }))).status).toBe(403)
    expect(m.authenticateAdmin).not.toHaveBeenCalled()
    expect(m.refresh).not.toHaveBeenCalled()
  })

  it('accepts a same-host referer when there is no origin, and refuses an unparseable one', async () => {
    expect((await POST(req({ origin: null, referer: 'https://acme.jeffistores.in/admin/merchant' }))).status).toBe(200)
    expect((await POST(req({ origin: null, referer: 'not a url' }))).status).toBe(403)
  })

  it('answers 401 signed out and 403 without merchant_sync:write', async () => {
    m.authenticateAdmin.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(401)
    m.authenticateAdmin.mockResolvedValue({ ...ADMIN, scopes: ['merchant_sync:read'] })
    expect((await POST(req())).status).toBe(403)
    expect(m.refresh).not.toHaveBeenCalled()
  })

  it('refreshes the Google Merchant status snapshot and returns the summary', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, summary: { products: 300, disapproved: 4 } })
    expect(m.refresh).toHaveBeenCalledTimes(1)
  })

  it('answers 409 while another refresh is running', async () => {
    m.refresh.mockResolvedValue({ locked: true })
    expect((await POST(req())).status).toBe(409)
  })

  it('answers 500 with the reason when Google fails', async () => {
    m.refresh.mockRejectedValue(new Error('Merchant API down'))
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Merchant API down')
  })
})
