import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/payments/financial', () => ({ getCashflow: vi.fn() }))

import { GET } from '@/app/api/(admin)/admin/financial/cashflow/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getCashflow } from '@/lib/payments/financial'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGetCashflow = vi.mocked(getCashflow)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['financial'] }

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/financial/cashflow')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
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

  it('returns cashflow data with default FY date range', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const data = {
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
    mockGetCashflow.mockResolvedValue(data)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(data)
    expect(mockGetCashflow).toHaveBeenCalledOnce()
  })

  it('passes explicit from/to params to getCashflow', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockGetCashflow.mockResolvedValue({ monthly: [] })

    const res = await GET(makeRequest({ from: '2024-01-01', to: '2024-03-31' }))
    expect(res.status).toBe(200)
    expect(mockGetCashflow).toHaveBeenCalledWith('2024-01-01', '2024-03-31')
  })

  it('returns 500 on getCashflow error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockGetCashflow.mockRejectedValue(new Error('DB error'))

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB error')
  })

  it('returns 500 with generic message when error has no message', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockGetCashflow.mockRejectedValue({})

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBeTruthy()
  })
})
