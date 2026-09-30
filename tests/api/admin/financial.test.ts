import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/payments/financial', () => ({
  getPLReport: vi.fn(),
  getReceivablesAging: vi.fn(),
}))

vi.mock('@/lib/catalog/gst', () => ({
  getFinancialYear: vi.fn(),
  round2: (n: number) => Math.round(n * 100) / 100,
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET as plGET } from '@/app/api/admin/financial/pl/route'
import { GET as receivablesGET } from '@/app/api/admin/financial/receivables/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getPLReport, getReceivablesAging } from '@/lib/payments/financial'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['financial'] }

function makeReq(url: string) {
  return new NextRequest(new Request(url))
}

// ---------------------------------------------------------------------------
// GET /api/admin/financial/pl
// ---------------------------------------------------------------------------

describe('GET /api/admin/financial/pl', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getPLReport).mockResolvedValue({
      revenue: 100000,
      cogs: 60000,
      grossProfit: 40000,
      expenses: 10000,
      netProfit: 30000,
    } as any)
  })

  it('returns P&L report for default financial year range', async () => {
    const res = await plGET(makeReq('http://localhost/api/admin/financial/pl'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ revenue: 100000, netProfit: 30000 })
    expect(getPLReport).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-04-01$/),
      expect.stringMatching(/^\d{4}-03-31$/)
    )
  })

  it('passes explicit from/to params to getPLReport', async () => {
    await plGET(makeReq('http://localhost/api/admin/financial/pl?from=2024-04-01&to=2025-03-31'))

    expect(getPLReport).toHaveBeenCalledWith('2024-04-01', '2025-03-31')
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await plGET(makeReq('http://localhost/api/admin/financial/pl'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when financial scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)

    const res = await plGET(makeReq('http://localhost/api/admin/financial/pl'))
    expect(res.status).toBe(403)
  })

  it('returns 500 when getPLReport throws', async () => {
    vi.mocked(getPLReport).mockRejectedValue(new Error('DB error'))

    const res = await plGET(makeReq('http://localhost/api/admin/financial/pl'))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('DB error')
  })
})

// ---------------------------------------------------------------------------
// GET /api/admin/financial/receivables
// ---------------------------------------------------------------------------

describe('GET /api/admin/financial/receivables', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getReceivablesAging).mockResolvedValue({
      rows: [{ customer_name: 'Acme Corp', outstanding: 5000 }],
      total: 1,
      totalOutstanding: 5000,
    } as any)
  })

  it('returns receivables aging report', async () => {
    const res = await receivablesGET(makeReq('http://localhost/api/admin/financial/receivables'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ rows: expect.any(Array), totalOutstanding: 5000 })
    expect(getReceivablesAging).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
  })

  it('passes from/to/search/page/customerPhone to getReceivablesAging', async () => {
    vi.mocked(getReceivablesAging).mockResolvedValue({ rows: [], total: 0 } as any)

    await receivablesGET(
      makeReq(
        'http://localhost/api/admin/financial/receivables?from=2024-01-01&to=2024-12-31&search=acme&customerPhone=9999999999&page=3'
      )
    )

    expect(getReceivablesAging).toHaveBeenCalledWith({
      from: '2024-01-01',
      to: '2024-12-31',
      search: 'acme',
      customerPhone: '9999999999',
      page: 3,
    })
  })

  it('omits undefined optional params from call', async () => {
    vi.mocked(getReceivablesAging).mockResolvedValue({ rows: [] } as any)

    await receivablesGET(makeReq('http://localhost/api/admin/financial/receivables'))

    expect(getReceivablesAging).toHaveBeenCalledWith({
      from: undefined,
      to: undefined,
      search: undefined,
      customerPhone: undefined,
      page: 1,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await receivablesGET(makeReq('http://localhost/api/admin/financial/receivables'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when financial scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)

    const res = await receivablesGET(makeReq('http://localhost/api/admin/financial/receivables'))
    expect(res.status).toBe(403)
  })

  it('returns 500 when getReceivablesAging throws', async () => {
    vi.mocked(getReceivablesAging).mockRejectedValue(new Error('Query failed'))

    const res = await receivablesGET(makeReq('http://localhost/api/admin/financial/receivables'))
    expect(res.status).toBe(500)
  })
})
