import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { PATCH } from '@/app/api/admin/inventory/cost/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['inventory'] }

function makeReq(body: object) {
  return new NextRequest('http://localhost/api/admin/inventory/cost', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/inventory/cost', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makeReq({ product_id: 'p1', cost_price: 100 }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when inventory scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makeReq({ product_id: 'p1', cost_price: 100 }))
    expect(res.status).toBe(403)
  })

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns 400 when product_id is missing', async () => {
    const res = await PATCH(makeReq({ cost_price: 100 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/product_id/i)
  })

  it('returns 400 when cost_price is missing', async () => {
    const res = await PATCH(makeReq({ product_id: 'p1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cost_price/i)
  })

  it('returns 400 when cost_price is NaN', async () => {
    const res = await PATCH(makeReq({ product_id: 'p1', cost_price: 'abc' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid cost_price/i)
  })

  it('returns 400 when cost_price is negative', async () => {
    const res = await PATCH(makeReq({ product_id: 'p1', cost_price: -10 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid cost_price/i)
  })

  // ── Happy path ───────────────────────────────────────────────────────────

  it('updates product cost_price when no variant_id provided', async () => {
    const res = await PATCH(makeReq({ product_id: 'p1', cost_price: 250 }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE products SET cost_price/), [250, 'p1'])
  })

  it('updates variant cost_price when variant_id is provided', async () => {
    const res = await PATCH(makeReq({ product_id: 'p1', variant_id: 'v1', cost_price: 99 }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE product_variants SET cost_price/), [99, 'v1'])
  })

  it('accepts cost_price of 0', async () => {
    const res = await PATCH(makeReq({ product_id: 'p1', cost_price: 0 }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 on db error', async () => {
    mockQuery.mockRejectedValue(new Error('DB down'))
    const res = await PATCH(makeReq({ product_id: 'p1', cost_price: 100 }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB down')
  })
})
