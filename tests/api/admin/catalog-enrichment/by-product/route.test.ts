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

import { GET } from '@/app/api/admin/catalog-enrichment/by-product/[productId]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['catalog_enrichment'] }

function makeReq(productId: string) {
  return new NextRequest(`http://localhost/api/admin/catalog-enrichment/by-product/${productId}`)
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/catalog-enrichment/by-product/[productId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq('p1'), { params: Promise.resolve({ productId: 'p1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq('p1'), { params: Promise.resolve({ productId: 'p1' }) })
    expect(res.status).toBe(403)
  })

  it('returns item: null when no row found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeReq('p1'), { params: Promise.resolve({ productId: 'p1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item).toBeNull()
  })

  it('returns enrichment item on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const row = { id: 'e1', product_id: 'p1', ai_description: 'Test', status: 'proposed' }
    mockQueryOne.mockResolvedValue(row)
    const res = await GET(makeReq('p1'), { params: Promise.resolve({ productId: 'p1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item).toEqual(row)
  })
})
