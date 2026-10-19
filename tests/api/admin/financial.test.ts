import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
  requireAdminScope: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/payments/financial', () => ({
  getPLReport: vi.fn(),
}))

vi.mock('@/lib/catalog/gst', () => ({
  getFinancialYear: vi.fn(),
  round2: (n: number) => Math.round(n * 100) / 100,
}))

vi.mock('@/app/api/(admin)/admin/financial/receivables/summary', () => ({
  getReceivablesOverview: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET as plGET } from '@/app/api/(admin)/admin/financial/pl/route'
import { GET as receivablesGET } from '@/app/api/(admin)/admin/financial/receivables/route'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getPLReport } from '@/lib/payments/financial'
import { getReceivablesOverview } from '@/app/api/(admin)/admin/financial/receivables/summary'

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
  const TOTALS = {
    revenue: 100000, refunds: 0, net_revenue: 100000, cogs: 60000, gross_profit: 40000,
    gross_margin_pct: 40, operating_expenses: 10000, operating_profit: 30000,
    tax_collected: 0, order_count: 10,
    revenue_online: 60000, revenue_business: 20000, revenue_cash_sale: 15000, revenue_offline: 5000,
  }
  const MONTHLY = [
    { month: '2024-04', revenue: 50000, cogs: 30000, gross_profit: 20000, net_revenue: 50000 },
    { month: '2024-05', revenue: 50000, cogs: 30000, gross_profit: 20000, net_revenue: 50000 },
  ]

  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getPLReport).mockResolvedValue({ totals: TOTALS, monthly: MONTHLY } as any)
  })

  it('returns the FinanceOverviewContract envelope for the default FY range', async () => {
    const res = await plGET(makeReq('http://localhost/api/admin/financial/pl'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({
      range: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      previous_range: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      bucket: expect.any(String),
      current: expect.objectContaining({ revenue: 100000, operating_profit: 30000 }),
      previous: expect.objectContaining({ revenue: 100000 }),
    })
    expect(Array.isArray(json.series)).toBe(true)
    expect(json.series[0]).toMatchObject({ label: '2024-04-01', revenue: 50000, cogs: 30000 })
    expect(json.by_dim).toEqual(MONTHLY)
    // by_dim2 is the non-zero revenue sources from totals
    expect(json.by_dim2.map((s: any) => s.key).sort()).toEqual(['business', 'cash_sale', 'offline', 'online'])
    // Default FY range: from is April 1 of the current FY; to is today (truncated).
    expect(getPLReport).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-04-01$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
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
  const OVERVIEW = {
    range: { from: '2024-09-19', to: '2024-10-18' },
    previous_range: { from: '2024-08-20', to: '2024-09-18' },
    bucket: 'day' as const,
    current: { outstanding: 5000, invoice_count: 1, overdue: 0, avg_days: 10 },
    previous: { outstanding: 2000, invoice_count: 0, overdue: 0, avg_days: 0 },
    series: [],
    by_aging: [],
    top_debtors: [],
    overdue: [],
  }

  beforeEach(() => {
    vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
    vi.mocked(getReceivablesOverview).mockResolvedValue(OVERVIEW as any)
  })

  it('returns the receivables overview envelope', async () => {
    const res = await receivablesGET(makeReq('http://localhost/api/admin/financial/receivables'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({
      range: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      previous_range: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      bucket: 'day',
      current: expect.objectContaining({ outstanding: 5000 }),
    })
  })

  it('passes the parsed period to getReceivablesOverview', async () => {
    await receivablesGET(
      makeReq('http://localhost/api/admin/financial/receivables?from=2024-09-01&to=2024-09-30')
    )

    expect(getReceivablesOverview).toHaveBeenCalledWith({ from: '2024-09-01', to: '2024-09-30' })
  })

  it('rejects malformed from/to with 400', async () => {
    const res = await receivablesGET(makeReq('http://localhost/api/admin/financial/receivables?from=bad&to=2024-09-30'))
    expect(res.status).toBe(400)
  })

  it('returns 401 when the scope guard refuses', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as any
    )

    const res = await receivablesGET(makeReq('http://localhost/api/admin/financial/receivables'))
    expect(res.status).toBe(401)
  })

  it('returns 500 when getReceivablesOverview throws', async () => {
    vi.mocked(getReceivablesOverview).mockRejectedValue(new Error('Query failed'))

    const res = await receivablesGET(makeReq('http://localhost/api/admin/financial/receivables'))
    expect(res.status).toBe(500)
  })
})
