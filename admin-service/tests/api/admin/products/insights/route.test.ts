import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/products/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/products/insights${qs}`)
const spec0 = () => vi.mocked(getInsightsSeries).mock.calls[0][0] as any

describe('GET /api/admin/products/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['products:read'] } as any)
    vi.mocked(getInsightsSeries).mockResolvedValue({ weeks: 26, filter: 'all', days: [], series: [] } as any)
  })

  it('is gated on products:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:read')
    expect(getInsightsSeries).not.toHaveBeenCalled()
  })

  it('defaults to 26 weeks and the all filter', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(spec0()).toMatchObject({ weeks: 26, filter: 'all' })
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

  it('reads products into 3 series', async () => {
    await GET(req())
    const spec = spec0()
    expect(spec.table).toBe('products')
    expect(spec.series.map((s: any) => s.key)).toEqual(['live', 'draft', 'inactive'])
  })

  it.each<[string, string | undefined]>([
    ['all', undefined],
    ['simple', 'NOT COALESCE(p.has_variants, false)'],
    ['variants', 'COALESCE(p.has_variants, false)'],
  ])('filter %s sets the where clause', async (filter, where) => {
    await GET(req(`?filter=${filter}`))
    expect(spec0().where).toBe(where)
  })

  it('returns 500 when the query throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValue(new Error('db fail'))
    expect((await GET(req())).status).toBe(500)
  })
})
