import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/search', () => ({
  buildProductSearchClause: vi.fn(),
  buildProductSearchRank: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/admin/labels/products/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import { buildProductSearchClause, buildProductSearchRank } from '@/lib/search'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['labels'] }

function makeReq(url: string) {
  return new NextRequest(new Request(url))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/labels/products', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(buildProductSearchClause).mockReturnValue({ clause: 'TRUE', params: [], nextIdx: 2 })
    vi.mocked(buildProductSearchRank).mockReturnValue({ rank: '(0+0)', params: [], nextIdx: 3 })
  })

  it('returns products list with no filters', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'product:p1', product_id: 'p1', name: 'Bolt M6', sku: 'BLT-001' },
    ] as any)

    const res = await GET(makeReq('http://localhost/api/admin/labels/products'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ products: expect.any(Array) })
    expect(json.products).toHaveLength(1)
  })

  it('returns empty products array when nothing found', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)

    const res = await GET(makeReq('http://localhost/api/admin/labels/products'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.products).toEqual([])
  })

  it('filters by product_id query param', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'product:p1', name: 'Nut M8' }] as any)
    const productId = '11111111-1111-1111-1111-111111111111'

    const res = await GET(makeReq(`http://localhost/api/admin/labels/products?product_id=${productId}`))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.products).toHaveLength(1)
  })

  it('applies search query and calls buildProductSearchClause', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)

    await GET(makeReq('http://localhost/api/admin/labels/products?q=bolt'))

    expect(buildProductSearchClause).toHaveBeenCalled()
  })

  it('respects limit param (capped at 200)', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)

    await GET(makeReq('http://localhost/api/admin/labels/products?limit=500'))

    // The route caps limit at 200; the last param pushed to queryMany should be 200
    const callArgs = vi.mocked(queryMany).mock.calls[0]
    const params = callArgs[1] as unknown[]
    expect(params).toContain(200)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await GET(makeReq('http://localhost/api/admin/labels/products'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when labels scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)

    const res = await GET(makeReq('http://localhost/api/admin/labels/products'))
    expect(res.status).toBe(403)
  })

  it('returns 500 on database error', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('DB connection failed'))

    const res = await GET(makeReq('http://localhost/api/admin/labels/products'))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })
})
