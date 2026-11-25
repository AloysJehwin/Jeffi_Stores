import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ authenticateAdmin: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: m.authenticateAdmin }))
vi.mock('@/lib/amazon/status', () => ({ refreshAmazonStatusSnapshot: m.refresh }))

import { POST } from '@admin/app/api/(admin)/admin/merchant/amazon/listing-status/refresh/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['merchant_sync:write'] }

// happy-dom drops the forbidden `host` header, so the request's header reads are overridden.
function req(overrides: Record<string, string | null> = {}) {
  const r = new NextRequest('https://acme.jeffistores.in/api/admin/merchant/amazon/listing-status/refresh', { method: 'POST' })
  const headers: Record<string, string | null> = { host: 'acme.jeffistores.in', origin: 'https://acme.jeffistores.in', 'x-requested-with': 'jeffi-admin', ...overrides }
  const original = r.headers.get.bind(r.headers)
  Object.defineProperty(r, 'headers', { value: { get: (n: string) => (n.toLowerCase() in headers ? headers[n.toLowerCase()] : original(n)) }, writable: false })
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticateAdmin.mockResolvedValue(ADMIN)
  m.refresh.mockResolvedValue({ listings: 120, issues: 3 })
})

describe('merchant amazon listing-status refresh route', () => {
  it('rejects a cross-origin request and a missing CSRF header with 403', async () => {
    expect((await POST(req({ origin: 'https://evil.example', referer: null }))).status).toBe(403)
    expect((await POST(req({ 'x-requested-with': null }))).status).toBe(403)
    expect(m.authenticateAdmin).not.toHaveBeenCalled()
    expect(m.refresh).not.toHaveBeenCalled()
  })

  it('answers 401 signed out and 403 without merchant_sync:write', async () => {
    m.authenticateAdmin.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(401)
    m.authenticateAdmin.mockResolvedValue({ ...ADMIN, scopes: ['merchant_sync:read'] })
    expect((await POST(req())).status).toBe(403)
    expect(m.refresh).not.toHaveBeenCalled()
  })

  it('refreshes the Amazon listing snapshot and returns the summary', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, summary: { listings: 120, issues: 3 } })
    expect(m.refresh).toHaveBeenCalledTimes(1)
  })

  it('answers 409 while another refresh is running', async () => {
    m.refresh.mockResolvedValue({ locked: true })
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('A refresh is already in progress')
  })

  it('answers 500 with the reason when Amazon fails', async () => {
    m.refresh.mockRejectedValue(new Error('SP-API down'))
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('SP-API down')
  })
})
