import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/search', () => ({
  buildProductSearchClause: vi.fn().mockReturnValue({ clause: 'TRUE', params: [], nextIdx: 2 }),
  buildProductSearchRank: vi.fn().mockReturnValue({ rank: '(0+0)', params: [], nextIdx: 3 }),
}))

import { GET } from '@/app/api/admin/quotations/products/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['quotations'] }

function makeReq(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/quotations/products')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/quotations/products', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns empty products list on happy path with no results', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.products).toEqual([])
  })

  it('returns products on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const products = [
      { id: 'product:p1', product_id: 'p1', variant_id: null, name: 'Bolt M6', sku: 'B1', mrp: 10 },
      { id: 'variant:v1', product_id: 'p1', variant_id: 'v1', name: 'Bolt M6', sku: 'V1', mrp: 8 },
    ]
    mockQueryMany.mockResolvedValue(products)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.products).toEqual(products)
  })

  it('passes search query to search helpers', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const { buildProductSearchClause, buildProductSearchRank } = await import('@/lib/search')
    const res = await GET(makeReq({ q: 'bolt' }))
    expect(res.status).toBe(200)
    expect(buildProductSearchClause).toHaveBeenCalled()
    expect(buildProductSearchRank).toHaveBeenCalled()
  })

  it('filters by category_id when provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeReq({ category_id: 'cat-1' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('$1::uuid'), expect.arrayContaining(['cat-1']))
  })

  it('respects featured filter', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeReq({ featured: 'true' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('is_featured = true'), expect.any(Array))
  })

  it('respects limit param', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeReq({ limit: '10' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([10]))
  })

  it('returns 500 on db error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockRejectedValue(new Error('db error'))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
  })
})
