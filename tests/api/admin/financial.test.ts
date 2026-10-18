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
