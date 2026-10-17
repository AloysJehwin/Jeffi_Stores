import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ requireAdminScope: vi.fn(), hasScope: vi.fn(), queryMany: vi.fn(), queryOne: vi.fn() }))

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: m.hasScope }))
vi.mock('@/lib/shared/db', () => ({ queryMany: m.queryMany, queryOne: m.queryOne }))

import { GET } from '@/app/api/(admin)/admin/reviews/overview/route'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/reviews/overview${qs}`)

function rowsFor(sql: string): unknown[] {
  if (sql.includes('AS with_photos'))
    return [
      { period: 'cur', reviews: '10', avg_rating: '4.20', positive: '8', negative: '1', with_photos: '3', verified: '9', approved: '7' },
      { period: 'prev', reviews: '5', avg_rating: '3.80', positive: '3', negative: '1', with_photos: '0', verified: '5', approved: '5' },
    ]
  if (sql.includes('generate_series(1, 5)')) return [1, 2, 3, 4, 5].map(r => ({ rating: r, count: String(r) }))
  if (sql.includes("interval '1 day'")) return [{ day: '2026-09-01', reviews: '2', negative: '0', avg_rating: '4.50' }]
  if (sql.includes('review_request')) return [{ period: 'cur', messages: '12', emails: '10', other_channels: '2', orders: '10', opened: '6', clicked: '3', reviewed: '2' }]
  if (sql.includes('before_avg')) return [{ id: 'p1', name: 'Drill', slug: 'drill', before_avg: '4.50', after_avg: '4.00', new_avg: '2.00', new_count: '2', before_count: '4' }]
  if (sql.includes('LEFT(pr.comment')) return [{ id: 'r1', rating: 1, title: 'Broken', comment: 'Arrived broken', created_at: '2026-09-02', is_approved: false, is_verified_purchase: true, product_id: 'p1', product_name: 'Drill', product_slug: 'drill', customer: 'Asha K' }]
  if (sql.includes('AS coupons')) return [{ period: 'cur', submissions: '4', coupons: '3', pending: '1' }]
  if (sql.includes('JOIN review_forms')) return [{ id: 'f1', title: 'Google', pending: '2' }]
  return []
}

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue({ adminId: 'a', role: 'admin', scopes: ['reviews:read'] })
  m.hasScope.mockReturnValue(true)
  m.queryMany.mockImplementation(async (sql: string) => rowsFor(sql))
  m.queryOne.mockImplementation(async (sql: string) =>
    sql.includes('is_approved = false') ? { count: '3', negative: '1', oldest: '2026-09-01' } : { reviews: '40', avg_rating: '4.31' }
  )
})

describe('GET /api/admin/reviews/overview', () => {
  it('returns the guard response when unauthorised', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(m.queryMany).not.toHaveBeenCalled()
  })

  it('gates on reviews:read and passes IST period bounds', async () => {
    const res = await GET(req('?from=2026-09-01&to=2026-09-30'))
    expect(res.status).toBe(200)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'reviews:read')
    const body = await res.json()
    expect(body.period).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(body.previous).toEqual({ from: '2026-08-02', to: '2026-08-31' })
    const kpiCall = m.queryMany.mock.calls.find(([sql]) => sql.includes('AS with_photos'))!
    expect(kpiCall[1]).toEqual(['2026-08-02', '2026-09-01', '2026-09-30'])
    expect(kpiCall[0]).toContain("AT TIME ZONE 'Asia/Kolkata'")
  })

  it('shapes KPIs, lists and the request funnel', async () => {
    const body = await (await GET(req('?from=2026-09-01&to=2026-09-30'))).json()
    expect(body.kpis.current).toMatchObject({ reviews: 10, avgRating: 4.2, positive: 8, withPhotos: 3 })
    expect(body.kpis.previous.reviews).toBe(5)
    expect(body.pending).toEqual({ count: 3, negative: 1, oldest: '2026-09-01' })
    expect(body.distribution).toHaveLength(5)
    expect(body.trend[0]).toEqual({ day: '2026-09-01', reviews: 2, negative: 0, avgRating: 4.5 })
    expect(body.funnel.current).toMatchObject({ orders: 10, opened: 6, reviewed: 2 })
    expect(body.funnel.previous.orders).toBe(0)
    expect(body.products.ratingDrops[0]).toMatchObject({ id: 'p1', beforeAvg: 4.5, afterAvg: 4 })
    expect(body.recentNegative[0]).toMatchObject({ id: 'r1', isApproved: false, customer: 'Asha K' })
    expect(body.forms.current).toEqual({ submissions: 4, coupons: 3, pending: 1 })
    expect(body.forms.pendingByForm).toEqual([{ id: 'f1', title: 'Google', pending: 2 }])
  })

  it('omits review-form data without review_forms:read', async () => {
    m.hasScope.mockReturnValue(false)
    const body = await (await GET(req())).json()
    expect(body.forms).toBeNull()
    expect(m.queryMany.mock.calls.some(([sql]) => sql.includes('review_form_submissions'))).toBe(false)
  })

  it('falls back to the default period on bad dates', async () => {
    const body = await (await GET(req('?from=nope&to=2026-09-30'))).json()
    expect(body.period.to >= body.period.from).toBe(true)
  })

  it('returns 500 when a query fails', async () => {
    m.queryMany.mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(req())).status).toBe(500)
  })
})
