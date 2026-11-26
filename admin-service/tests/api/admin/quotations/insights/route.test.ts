import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/quotations/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const mockGet = vi.mocked(getInsightsSeries)

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/quotations/insights')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['quotations:read'] } as any)
  mockGet.mockResolvedValue({ weeks: 26, filter: null, series: [], days: [] } as any)
})

describe('GET /api/admin/quotations/insights', () => {
  it('is gated on quotations:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await GET(makeReq())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'quotations:read')
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('defaults to 26 weeks over quotations by quote_date and returns the series', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ table: 'quotations', dateColumn: 'quote_date', weeks: 26, filter: null }))
    expect((await res.json()).series.weeks).toBe(26)
    expect(mockGet.mock.calls[0][0].series?.map(s => s.key)).toEqual(['awaiting', 'converted'])
  })

  it.each([13, 26, 52])('accepts %i weeks', async weeks => {
    expect((await GET(makeReq({ weeks: String(weeks) }))).status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ weeks }))
  })

  it.each([{ weeks: '12' }, { weeks: 'abc' }, { weeks: '104' }])('400 on bad weeks %j', async params => {
    expect((await GET(makeReq(params))).status).toBe(400)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns 500 when the query throws', async () => {
    mockGet.mockRejectedValue(new Error('db fail'))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db fail')
  })
})
