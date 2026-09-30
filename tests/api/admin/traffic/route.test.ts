import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/traffic/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['dashboard'] }

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/traffic')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

// A 12-element array matching the Promise.all destructuring in the route
function makeQueryManyResults() {
  return [
    // funnel
    [
      { page: 'home', sessions: '100', users: '80' },
      { page: 'product', sessions: '50', users: '40' },
      { page: 'order_placed', sessions: '10', users: '9' },
    ],
    // topPages
    [{ path: '/', hits: '200', sessions: '100' }],
    // topReferrers
    [{ referrer: 'google.com', sessions: '50' }],
    // dailySessions
    [{ date: '2024-01-01', sessions: '100', pageviews: '200' }],
    // devices
    [
      { type: 'Mobile', sessions: '60' },
      { type: 'Desktop', sessions: '40' },
    ],
    // browsers
    [{ browser: 'Chrome', sessions: '80' }],
    // hourly
    [
      { hour: '10', hits: '30' },
      { hour: '14', hits: '50' },
    ],
    // sessionDepths
    [
      { session_id: 's1', depth: '1' },
      { session_id: 's2', depth: '5' },
      { session_id: 's3', depth: '3' },
    ],
    // topProducts
    [
      {
        product_id: 'p1',
        name: 'Bolt',
        slug: 'bolt',
        views: '100',
        unique_viewers: '80',
        orders: '5',
        revenue: '250.00',
        cart_adds: '20',
      },
    ],
    // conversionLaggards
    [{ product_id: 'p2', name: 'Nut', slug: 'nut', views: '50', orders: '0' }],
    // topSearchTerms
    [{ query: 'bolt', searches: '30', clicks: '25' }],
    // noResultSearches
    [{ query: 'unobtanium', searches: '5' }],
  ]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/traffic', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns full traffic dashboard on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const results = makeQueryManyResults()
    results.forEach((r, idx) => {
      mockQueryMany.mockResolvedValueOnce(r as any)
    })

    const res = await GET(makeGet({ days: '7' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.funnel).toBeDefined()
    expect(body.topPages).toBeDefined()
    expect(body.topReferrers).toBeDefined()
    expect(body.dailySessions).toBeDefined()
    expect(body.devices).toBeDefined()
    expect(body.browsers).toBeDefined()
    expect(body.hourly).toHaveLength(24)
    expect(body.topProducts).toBeDefined()
    expect(body.conversionLaggards).toBeDefined()
    expect(body.topSearchTerms).toBeDefined()
    expect(body.noResultSearches).toBeDefined()
    expect(body.totals).toBeDefined()
  })

  it('computes funnel percentages correctly', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const results = makeQueryManyResults()
    results.forEach(r => mockQueryMany.mockResolvedValueOnce(r as any))

    const res = await GET(makeGet())
    const body = await res.json()

    const homeFunnel = body.funnel.find((s: any) => s.page === 'home')
    expect(homeFunnel.pct).toBe(100) // home is the top, so 100%
    const productFunnel = body.funnel.find((s: any) => s.page === 'product')
    expect(productFunnel.pct).toBe(50) // 50/100
  })

  it('computes totals: sessions, pageviews, conversions, bounceRate, avgPages', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const results = makeQueryManyResults()
    results.forEach(r => mockQueryMany.mockResolvedValueOnce(r as any))

    const res = await GET(makeGet())
    const body = await res.json()

    expect(body.totals.sessions).toBe(100)
    expect(body.totals.pageviews).toBe(200)
    expect(body.totals.conversions).toBe(10)
    // 1 of 3 sessions has depth=1 → bounceRate = 33%
    expect(body.totals.bounceRate).toBe(33)
    // avg = (1+5+3)/3 = 3
    expect(body.totals.avgPages).toBe(3)
  })

  it('fills hourly array to 24 entries with zeros for missing hours', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const results = makeQueryManyResults()
    results.forEach(r => mockQueryMany.mockResolvedValueOnce(r as any))

    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.hourly).toHaveLength(24)
    expect(body.hourly[0]).toEqual({ hour: 0, hits: 0 })
    expect(body.hourly[10]).toEqual({ hour: 10, hits: 30 })
  })

  it('clamps days param between 1 and 90', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const results = makeQueryManyResults()
    results.forEach(r => mockQueryMany.mockResolvedValueOnce(r as any))

    // Pass days=999 — should be clamped to 90
    await GET(makeGet({ days: '999' }))
    const firstCall = mockQueryMany.mock.calls[0]
    expect(firstCall[1]).toEqual([90])
  })

  it('maps topProducts with conversionRate', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const results = makeQueryManyResults()
    results.forEach(r => mockQueryMany.mockResolvedValueOnce(r as any))

    const res = await GET(makeGet())
    const body = await res.json()

    const p = body.topProducts[0]
    expect(p.productId).toBe('p1')
    expect(p.views).toBe(100)
    expect(p.orders).toBe(5)
    expect(p.revenue).toBe(250)
    // conversionRate = round(5/100*1000)/10 = 5.0
    expect(p.conversionRate).toBe(5)
  })

  it('handles empty result sets gracefully', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    // Return empty arrays for all 12 queries
    for (let i = 0; i < 12; i++) {
      mockQueryMany.mockResolvedValueOnce([])
    }

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totals.bounceRate).toBe(0)
    expect(body.totals.avgPages).toBe(0)
    // topSessions falls back to 1, home step has 0 sessions → pct=0
    const home = body.funnel.find((s: any) => s.page === 'home')
    expect(home.pct).toBe(0)
  })

  it('handles search-log query failure gracefully (catches error)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const results = makeQueryManyResults()
    // Replace topSearchTerms and noResultSearches (indices 10 and 11) with rejections
    results[10] = [] as any
    results[11] = [] as any
    results.forEach(r => mockQueryMany.mockResolvedValueOnce(r as any))

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.topSearchTerms)).toBe(true)
    expect(Array.isArray(body.noResultSearches)).toBe(true)
  })
})
