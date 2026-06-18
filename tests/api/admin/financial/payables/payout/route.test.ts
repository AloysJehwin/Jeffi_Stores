import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

// Stub env vars via vi.stubEnv (these run at evaluation time, before dynamic imports)
vi.stubEnv('RAZORPAYX_KEY_ID', 'rzp_key')
vi.stubEnv('RAZORPAYX_KEY_SECRET', 'rzp_secret')
vi.stubEnv('RAZORPAYX_ACCOUNT_NUMBER', 'acc_123')

import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Dynamically import the route module AFTER env stubs are applied so
// module-level constants (RZP_KEY etc.) capture the stubbed values.
let POST: typeof import('@/app/api/admin/financial/payables/[id]/payout/route').POST

beforeEach(async () => {
  vi.clearAllMocks()
  if (!POST) {
    const mod = await import('@/app/api/admin/financial/payables/[id]/payout/route')
    POST = mod.POST
  }
})

import { NextRequest } from 'next/server'

const admin = {
  adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['financial'],
}

const params = { id: 'exp-1' }

const baseExpense = {
  id: 'exp-1',
  expense_number: 'EXP-001',
  supplier_name: 'Acme Corp',
  supplier_email: 'acme@example.com',
  supplier_phone: '9999999999',
  bank_name: 'HDFC',
  account_number: '12345678',
  ifsc: 'HDFC0001',
  upi_id: null,
  po_id: 'po-1',
  total_amount: '1000',
}

function makeReq(body: any) {
  return new NextRequest(`http://localhost/api/admin/financial/payables/exp-1/payout`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/admin/financial/payables/[id]/payout', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq({ mode: 'NEFT', amount: 500 }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq({ mode: 'NEFT', amount: 500 }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 when body is invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const req = new NextRequest(`http://localhost/api/admin/financial/payables/exp-1/payout`, {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'text/plain' },
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
  })

  it('returns 404 when expense not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeReq({ mode: 'NEFT', amount: 500 }), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 when UPI mode but no upi_id', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ ...baseExpense, upi_id: null })
    const res = await POST(makeReq({ mode: 'UPI', amount: 500 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/UPI/i)
  })

  it('returns 400 when bank mode but no account/ifsc', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ ...baseExpense, account_number: null, ifsc: null })
    const res = await POST(makeReq({ mode: 'NEFT', amount: 500 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/bank account/i)
  })

  it('returns 500 when RazorpayX contact creation fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(baseExpense)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { description: 'RZP contact error' } }),
    } as any)
    const res = await POST(makeReq({ mode: 'NEFT', amount: 500 }), { params })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/RZP contact error/)
  })

  it('returns success on happy path with NEFT', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce(baseExpense)
      .mockResolvedValueOnce({ paid: '500' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'cont_1' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'fa_1' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'pout_1', status: 'queued' }) } as any)
    const res = await POST(makeReq({ mode: 'NEFT', amount: 500, notes: 'Payment' }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.payout_id).toBe('pout_1')
  })

  it('returns success on happy path with UPI', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ ...baseExpense, upi_id: 'test@upi' })
      .mockResolvedValueOnce({ paid: '200' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'cont_2' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'fa_2' }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'pout_2', status: 'processing' }) } as any)
    const res = await POST(makeReq({ mode: 'UPI', amount: 200 }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValueOnce(new Error('DB crash'))
    const res = await POST(makeReq({ mode: 'NEFT', amount: 500 }), { params })
    expect(res.status).toBe(500)
  })
})
