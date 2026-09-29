import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/admin-product-analytics', () => ({
  getProductAnalyticsData: vi.fn(),
}))

import { GET } from '@/app/api/admin/products/[id]/analytics/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getProductAnalyticsData } from '@/lib/admin-product-analytics'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGetAnalytics = vi.mocked(getProductAnalyticsData)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }

function makeReq(id: string, days?: string) {
  const url = new URL(`http://localhost/api/admin/products/${id}/analytics`)
  if (days) url.searchParams.set('days', days)
  return new NextRequest(url)
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/products/[id]/analytics', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq('prod-1'), { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq('prod-1'), { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 when product not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockGetAnalytics.mockResolvedValue(null)
    const res = await GET(makeReq('prod-1'), { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(404)
  })

  it('returns analytics data on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const data = { views: 100, revenue: 500 }
    mockGetAnalytics.mockResolvedValue(data as any)
    const res = await GET(makeReq('prod-1', '30'), { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(data)
    expect(mockGetAnalytics).toHaveBeenCalledWith('prod-1', 30)
  })

  it('clamps days to min 1 and max 365', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockGetAnalytics.mockResolvedValue({ ok: true } as any)
    await GET(makeReq('prod-1', '0'), { params: Promise.resolve({ id: 'prod-1' }) })
    expect(mockGetAnalytics).toHaveBeenCalledWith('prod-1', 1)
    await GET(makeReq('prod-1', '9999'), { params: Promise.resolve({ id: 'prod-1' }) })
    expect(mockGetAnalytics).toHaveBeenCalledWith('prod-1', 365)
  })
})
