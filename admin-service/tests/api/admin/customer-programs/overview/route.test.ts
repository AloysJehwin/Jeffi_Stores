import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({
  getLoyaltySettings: vi.fn(async () => ({ enabled: true, pointValue: 0.5, minRedeemPoints: 100 })),
}))
vi.mock('@/lib/referrals/settings', () => ({
  getReferralSettings: vi.fn(async () => ({ enabled: true, qualifyDays: 30 })),
}))
vi.mock('@/lib/loyalty/queries', () => ({
  getLoyaltyStats: vi.fn(async () => ({
    members: 2,
    outstandingPoints: 500,
    redeemedPoints: 0,
    byTier: { bronze: 2 },
  })),
}))
vi.mock('@/lib/referrals/queries', () => ({
  getReferralStats: vi.fn(async () => ({ signups: 0, byStatus: {}, pointsPaid: 0, referrers: 0 })),
}))

import { GET } from '@admin/app/api/(admin)/admin/customer-programs/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/customer-programs/overview${qs}`)

describe('GET /api/admin/customer-programs/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({
      adminId: 'a1',
      role: 'manager',
      scopes: ['campaigns:read'],
    } as any)
    vi.mocked(queryOne).mockResolvedValue({} as any)
    vi.mocked(queryMany).mockResolvedValue([])
  })

  it('is gated on campaigns:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    )
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'campaigns:read')
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns the period, the previous period and the attention list', async () => {
    const res = await GET(req('?from=2026-10-01&to=2026-10-10'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.period).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(j.previous).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(Array.isArray(j.attention)).toBe(true)
    expect(j).toHaveProperty('loyalty')
    expect(j).toHaveProperty('referrals')
    expect(j.loyalty.liability).toBe(250)
    expect(j.loyalty.by_tier).toEqual({ bronze: 2 })
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['2026-09-21', '2026-10-01', '2026-10-10'])
  })

  it('falls back to the default period on a bad range', async () => {
    const j = await (await GET(req('?from=2026-10-10&to=2026-10-01'))).json()
    expect(j.period.from <= j.period.to).toBe(true)
  })

  it('returns 500 when a query fails', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(req())).status).toBe(500)
  })
})
