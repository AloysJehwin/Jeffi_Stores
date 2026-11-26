import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/invoices/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const mockGet = vi.mocked(getInsightsSeries)

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/invoices/insights')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['invoices:read'] } as any)
  mockGet.mockResolvedValue({ weeks: 26, filter: 'all', series: [], days: [] } as any)
})

describe('GET /api/admin/invoices/insights', () => {
  it('is gated on invoices:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await GET(makeReq())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'invoices:read')
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('defaults to 26 weeks over orders by invoice_date and returns the series', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ table: 'orders', dateColumn: 'invoice_date', weeks: 26, filter: 'all' }))
    expect((await res.json()).series.weeks).toBe(26)
    expect(mockGet.mock.calls[0][0].series?.map(s => s.key)).toEqual(['paid', 'outstanding', 'refunded'])
  })

  it.each([13, 26, 52])('accepts %i weeks', async weeks => {
    expect((await GET(makeReq({ weeks: String(weeks) }))).status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ weeks }))
  })

  it.each([{ weeks: '12' }, { weeks: 'abc' }, { weeks: '104' }])('400 on bad weeks %j', async params => {
    expect((await GET(makeReq(params))).status).toBe(400)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it.each(['all','b2b','b2c'])('accepts filter %s', async filter => {
    expect((await GET(makeReq({ filter }))).status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ filter }))
  })

  it('narrows the query for a non-default filter', async () => {
    await GET(makeReq({ filter: 'b2b' }))
    expect(mockGet.mock.calls[0][0].where).toContain('NULLIF(TRIM(o.buyer_gstin), \'\') IS NOT NULL')
  })

  it('400 on an unknown filter', async () => {
    expect((await GET(makeReq({ filter: 'nope' }))).status).toBe(400)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns 500 when the query throws', async () => {
    mockGet.mockRejectedValue(new Error('db fail'))
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db fail')
  })
})
