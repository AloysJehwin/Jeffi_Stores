import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@controller/app/api/(admin)/admin/financial/cashflow/summary', () => ({ getCashflowOverview: vi.fn() }))

import { GET } from '@controller/app/api/(admin)/admin/financial/cashflow/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getCashflowOverview } from '@controller/app/api/(admin)/admin/financial/cashflow/summary'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGet = vi.mocked(getCashflowOverview)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['financial'] }

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/financial/cashflow')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

function overview(from: string, to: string) {
  return {
    range: { from, to },
    previous_range: { from: '2023-10-01', to: '2023-12-31' },
    bucket: 'month' as const,
    current: { cash_in: 100000, cash_out: 60000, net: 40000, opening_balance: 0, closing_balance: 40000 },
    previous: { cash_in: 90000, cash_out: 55000, net: 35000, opening_balance: 0, closing_balance: 0 },
    series: [{ label: '2026-01-01', cash_in: 100000, cash_out: 60000, net: 40000 }],
    by_dim: [{ key: 'online', label: 'Online', amount: 60000 }],
    by_dim2: [{ key: 'po_payments', label: 'Supplier payments', amount: 50000 }],
    monthly: [
      {
        month: '2026-01',
        cash_in: 100000,
        cash_in_online: 60000,
        cash_in_business: 30000,
        cash_in_cash_sale: 10000,
        cash_in_offline: 0,
        po_payments: 50000,
        refunds_out: 10000,
        cash_out: 60000,
        net: 40000,
        running_balance: 40000,
      },
    ],
  }
}

describe('GET /api/admin/financial/cashflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns the FinanceOverviewContract shape on success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const data = overview('2024-01-01', '2024-03-31')
    mockGet.mockResolvedValue(data)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(data)
    expect(mockGet).toHaveBeenCalledOnce()
  })

  it('passes explicit from/to params through parsePeriod', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockGet.mockResolvedValue(overview('2024-01-01', '2024-03-31'))

    const res = await GET(makeRequest({ from: '2024-01-01', to: '2024-03-31' }))
    expect(res.status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({ from: '2024-01-01', to: '2024-03-31' }))
  })

  it('rejects malformed from/to with 400', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await GET(makeRequest({ from: 'bad', to: '2024-03-31' }))
    expect(res.status).toBe(400)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns 500 on helper error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockGet.mockRejectedValue(new Error('DB error'))

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB error')
  })

  it('returns 500 with generic message when error has no message', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockGet.mockRejectedValue({})

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBeTruthy()
  })
})
