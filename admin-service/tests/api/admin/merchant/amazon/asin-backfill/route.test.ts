import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ authenticateAdmin: vi.fn(), backfill: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: m.authenticateAdmin }))
vi.mock('@/lib/amazon/asin-backfill', () => ({ backfillAsins: m.backfill }))

import { POST } from '@admin/app/api/(admin)/admin/merchant/amazon/asin-backfill/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['merchant_sync:write'] }

// happy-dom drops the forbidden `host` header, so the request's header reads are overridden.
function req(body: unknown = {}, overrides: Record<string, string | null> = {}) {
  const r = new NextRequest('https://acme.jeffistores.in/api/admin/merchant/amazon/asin-backfill', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  const headers: Record<string, string | null> = { host: 'acme.jeffistores.in', origin: 'https://acme.jeffistores.in', 'x-requested-with': 'jeffi-admin', ...overrides }
  const original = r.headers.get.bind(r.headers)
  Object.defineProperty(r, 'headers', { value: { get: (n: string) => (n.toLowerCase() in headers ? headers[n.toLowerCase()] : original(n)) }, writable: false })
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticateAdmin.mockResolvedValue(ADMIN)
  m.backfill.mockResolvedValue({ matched: 5, updated: 0 })
})

describe('merchant amazon asin-backfill route', () => {
  it('rejects a cross-origin request and a missing CSRF header with 403, touching nothing', async () => {
    expect((await POST(req({}, { origin: 'https://evil.example', referer: null }))).status).toBe(403)
    expect((await POST(req({}, { 'x-requested-with': null }))).status).toBe(403)
    expect(m.authenticateAdmin).not.toHaveBeenCalled()
    expect(m.backfill).not.toHaveBeenCalled()
  })

  it('answers 401 when nobody is signed in', async () => {
    m.authenticateAdmin.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(401)
    expect(m.backfill).not.toHaveBeenCalled()
  })

  it('needs merchant_sync:write', async () => {
    m.authenticateAdmin.mockResolvedValue({ ...ADMIN, scopes: ['merchant_sync:read'] })
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
    expect(m.backfill).not.toHaveBeenCalled()
  })

  it('defaults to a dry run so nothing is written', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, report: { matched: 5, updated: 0 } })
    expect(m.backfill).toHaveBeenCalledWith({ dryRun: true, brand: undefined, limit: undefined })
  })

  it('writes only when dryRun is explicitly false, passing brand and limit', async () => {
    await POST(req({ dryRun: false, brand: 'Acme', limit: '25' }))
    expect(m.backfill).toHaveBeenCalledWith({ dryRun: false, brand: 'Acme', limit: 25 })
  })

  it('treats an unreadable body as a dry run', async () => {
    const res = await POST(req('not json'))
    expect(res.status).toBe(200)
    expect(m.backfill).toHaveBeenCalledWith({ dryRun: true, brand: undefined, limit: undefined })
  })

  it('answers 500 with the reason when the backfill fails', async () => {
    m.backfill.mockRejectedValue(new Error('Catalog API throttled'))
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Catalog API throttled')
  })
})
