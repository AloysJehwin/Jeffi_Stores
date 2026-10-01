import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

import { GET } from '@/app/api/(admin)/admin/inflation/products/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

const adminPayload = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['inflation'] }

function makeReq(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/inflation/products')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/inflation/products', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq({ category_id: '1' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq({ category_id: '1' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Insufficient permissions')
  })

  it('returns 400 when category_id missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeReq())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/category_id/)
  })

  it('returns products on happy path', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const products = [{ id: 'p1', name: 'Bolt' }]
    mockQueryMany.mockResolvedValue(products)
    const res = await GET(makeReq({ category_id: 'cat-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.products).toEqual(products)
  })

  it('returns empty array when queryMany returns null-ish', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeReq({ category_id: 'cat-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.products).toEqual([])
  })
})
