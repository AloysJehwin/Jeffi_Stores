import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/queries', () => ({
  getBrochureProductsByCategories: vi.fn(),
  getBrochureProductsByBrands: vi.fn(),
}))

import { GET } from '@/app/api/(admin)/admin/brochure/products/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getBrochureProductsByCategories, getBrochureProductsByBrands } from '@/lib/queries'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockByCats = vi.mocked(getBrochureProductsByCategories)
const mockByBrands = vi.mocked(getBrochureProductsByBrands)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const CAT = '11111111-1111-4111-8111-111111111111'
const BRAND = '22222222-2222-4222-8222-222222222222'

function makeReq(qs: string) {
  return new NextRequest(`http://localhost/api/admin/brochure/products?${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/brochure/products', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq(`categoryIds=${CAT}`))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq(`categoryIds=${CAT}`))
    expect(res.status).toBe(403)
  })

  it('returns empty list when no ids given', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeReq(''))
    expect(res.status).toBe(200)
    expect((await res.json()).products).toEqual([])
  })

  it('lists products by categories', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockByCats.mockResolvedValue([{ id: 'p1', name: 'Bolt' }] as any)
    const res = await GET(makeReq(`categoryIds=${CAT}`))
    expect(res.status).toBe(200)
    expect(mockByCats).toHaveBeenCalledWith([CAT])
    expect((await res.json()).products).toHaveLength(1)
  })

  it('lists products by brands', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockByBrands.mockResolvedValue([{ id: 'p2', name: 'Nut' }] as any)
    const res = await GET(makeReq(`brandIds=${BRAND}`))
    expect(res.status).toBe(200)
    expect(mockByBrands).toHaveBeenCalledWith([BRAND])
  })

  it('ignores non-UUID ids', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeReq('categoryIds=bad&brandIds=also-bad'))
    expect(res.status).toBe(200)
    expect((await res.json()).products).toEqual([])
    expect(mockByCats).not.toHaveBeenCalled()
    expect(mockByBrands).not.toHaveBeenCalled()
  })
})
