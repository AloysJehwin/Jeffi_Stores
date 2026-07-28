import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getDashboardAnalytics: vi.fn() }))

import { GET } from '@/app/api/admin/dashboard/analytics/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getDashboardAnalytics } from '@/lib/queries'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGet = vi.mocked(getDashboardAnalytics)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['dashboard'] }

function makeReq(range?: string) {
  const url = new URL('http://localhost/api/admin/dashboard/analytics')
  if (range) url.searchParams.set('range', range)
  return new NextRequest(url.toString())
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/dashboard/analytics', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq('30d'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when dashboard:read scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq('30d'))
    expect(res.status).toBe(403)
  })

  it('returns analytics for a valid range', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockGet.mockResolvedValue({ range: '7d', rangeLabel: 'Last 7 days' } as any)
    const res = await GET(makeReq('7d'))
    expect(res.status).toBe(200)
    expect((await res.json()).analytics.range).toBe('7d')
    expect(mockGet).toHaveBeenCalledWith('7d')
  })

  it('falls back to 30d for an invalid range', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockGet.mockResolvedValue({ range: '30d' } as any)
    const res = await GET(makeReq('bogus'))
    expect(res.status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith('30d')
  })

  it('defaults to 30d when range param is absent', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockGet.mockResolvedValue({ range: '30d' } as any)
    await GET(makeReq())
    expect(mockGet).toHaveBeenCalledWith('30d')
  })
})
