import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/customer-programs/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/customer-programs/insights${qs}`)
const spec0 = () => vi.mocked(getInsightsSeries).mock.calls[0][0] as any

describe('GET /api/admin/customer-programs/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['campaigns:read'] } as any)
    vi.mocked(getInsightsSeries).mockResolvedValue({ weeks: 26, filter: 'loyalty', days: [], series: [] } as any)
  })

  it('is gated on campaigns:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'campaigns:read')
    expect(getInsightsSeries).not.toHaveBeenCalled()
  })

  it('defaults to 26 weeks and the loyalty filter', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(spec0()).toMatchObject({ weeks: 26, filter: 'loyalty' })
    expect((await res.json()).series.weeks).toBe(26)
  })

  it.each([13, 26, 52])('accepts %i weeks', async weeks => {
    expect((await GET(req(`?weeks=${weeks}`))).status).toBe(200)
    expect(spec0().weeks).toBe(weeks)
  })

  it.each(['12', 'abc', '104'])('400 on bad weeks %s', async weeks => {
    expect((await GET(req(`?weeks=${weeks}`))).status).toBe(400)
    expect(getInsightsSeries).not.toHaveBeenCalled()
  })

  it('400 on an unknown filter', async () => {
    expect((await GET(req('?filter=nope'))).status).toBe(400)
    expect(getInsightsSeries).not.toHaveBeenCalled()
  })

  it('reads loyalty_ledger for filter loyalty', async () => {
    await GET(req('?filter=loyalty'))
    const spec = spec0()
    expect(spec.table).toBe('loyalty_ledger')
    expect(spec.series.map((s: any) => s.key)).toEqual(['earned', 'redeemed', 'reversed'])
    expect(spec.filter).toBe('loyalty')
  })

  it('reads referral_signups for filter referrals', async () => {
    await GET(req('?filter=referrals'))
    const spec = spec0()
    expect(spec.table).toBe('referral_signups')
    expect(spec.series.map((s: any) => s.key)).toEqual(['joined', 'rewarded'])
    expect(spec.filter).toBe('referrals')
  })

  it('returns 500 when the query throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValue(new Error('db fail'))
    expect((await GET(req())).status).toBe(500)
  })
})
