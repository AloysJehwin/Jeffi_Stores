import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@/app/api/admin/financial/payables/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['financial'] }
const params = { id: 'expense-123' }

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/financial/payables/expense-123')
}

const sampleExpense = {
  id: 'expense-123',
  expense_number: 'EXP-001',
  amount: 5000,
  tax_amount: 900,
  total_amount: 5900,
  status: 'pending',
  supplier_name_from_db: 'Acme Supplies',
  po_number: 'PO-001',
}

const samplePayments = [
  { id: 'pay-1', amount: 2000, payment_date: '2024-01-10', payment_method: 'bank_transfer' },
]

describe('GET /api/admin/financial/payables/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when expense not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns expense with payments on success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleExpense)
    mockQueryMany.mockResolvedValue(samplePayments)

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.expense.expense_number).toBe('EXP-001')
    expect(body.payments).toHaveLength(1)
  })

  it('returns empty payments array when queryMany returns null', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleExpense)
    mockQueryMany.mockResolvedValue(null as any)

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payments).toEqual([])
  })

  it('returns 500 on database error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB failure'))

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB failure')
  })
})
