import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/payments/financial', () => ({
  getPayables: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/financial/payables/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { getPayables } from '@/lib/payments/financial'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['financial'] }

function makeGet(qs = '') {
  return new NextRequest(`http://localhost/api/admin/financial/payables${qs}`)
}

function makePost(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/financial/payables', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const PAYABLES_RESULT = {
  payables: [{ id: 'p1', supplier_name: 'Supplier A', amount: 5000 }],
  total: 1,
}

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/financial/payables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing financial scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
  })

  it('returns payables result', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getPayables).mockResolvedValue(PAYABLES_RESULT as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(PAYABLES_RESULT)
  })

  it('passes query params to getPayables', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getPayables).mockResolvedValue(PAYABLES_RESULT as any)
    await GET(makeGet('?status=pending&from=2024-01-01&to=2024-01-31&search=acme&page=2'))
    expect(vi.mocked(getPayables)).toHaveBeenCalledWith({
      status: 'pending',
      from: '2024-01-01',
      to: '2024-01-31',
      search: 'acme',
      page: 2,
    })
  })

  it('passes undefined for empty string params', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getPayables).mockResolvedValue(PAYABLES_RESULT as any)
    await GET(makeGet())
    expect(vi.mocked(getPayables)).toHaveBeenCalledWith({
      status: undefined,
      from: undefined,
      to: undefined,
      search: undefined,
      page: 1,
    })
  })

  it('returns 500 on error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getPayables).mockRejectedValue(new Error('db error'))
    const res = await GET(makeGet())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'db error' })
  })
})

// ── POST tests ────────────────────────────────────────────────────────────────

describe('POST /api/admin/financial/payables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const VALID_BODY = {
    supplier_name: 'Acme Supplies',
    amount: 10000,
    expense_date: '2024-01-15',
    tax_amount: '1800',
    supplier_gstin: '33AABCU9603R1ZX',
    description: 'Bolts purchase',
    due_date: '2024-02-15',
    notes: 'Urgent',
  }

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing financial scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('returns 400 when supplier_name missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ amount: 1000, expense_date: '2024-01-01' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('supplier_name') })
  })

  it('returns 400 when amount missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ supplier_name: 'Acme', expense_date: '2024-01-01' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when expense_date missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ supplier_name: 'Acme', amount: 1000 }))
    expect(res.status).toBe(400)
  })

  it('creates expense and returns id and expense_number', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ count: '4' } as any)
      .mockResolvedValueOnce({ id: 'exp-new' } as any)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.id).toBe('exp-new')
    expect(body.expense_number).toBe('EXP-0005')
  })

  it('formats expense number with zero padding', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ count: '0' } as any)
      .mockResolvedValueOnce({ id: 'exp-1' } as any)
    const res = await POST(makePost(VALID_BODY))
    const body = await res.json()
    expect(body.expense_number).toBe('EXP-0001')
  })

  it('calculates total as amount + tax_amount', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ count: '0' } as any)
      .mockResolvedValueOnce({ id: 'exp-1' } as any)
    await POST(makePost(VALID_BODY))
    const insertArgs = vi.mocked(queryOne).mock.calls[1][1] as any[]
    // $1=expenseNumber, $2=supplier_name, $3=gstin, $4=description, $5=amount, $6=taxNum, $7=totalNum
    // 0-based indices: 4=amount, 5=tax, 6=total
    expect(insertArgs[4]).toBe(10000)
    expect(insertArgs[5]).toBe(1800)
    expect(insertArgs[6]).toBe(11800)
  })

  it('uses tax_amount 0 when not provided', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ count: '0' } as any)
      .mockResolvedValueOnce({ id: 'exp-1' } as any)
    await POST(makePost({ supplier_name: 'Acme', amount: 5000, expense_date: '2024-01-01' }))
    const insertArgs = vi.mocked(queryOne).mock.calls[1][1] as any[]
    // 0-based: index 5=tax, index 6=total
    expect(insertArgs[5]).toBe(0)
    expect(insertArgs[6]).toBe(5000)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockRejectedValue(new Error('insert failed'))
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'insert failed' })
  })
})
