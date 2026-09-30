import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

// zCurrency must expose .refine() because the route calls it at module-load time
const mockRefine = vi.fn().mockReturnThis()
vi.mock('@/lib/shared/validate', () => ({
  parseBody: vi.fn(),
  zCurrency: { refine: vi.fn().mockReturnThis() },
  zNonEmpty: { refine: vi.fn().mockReturnThis() },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/financial/payables/[id]/pay/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { parseBody } from '@/lib/shared/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockParseBody = vi.mocked(parseBody)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['financial'],
}

const EXPENSE_ID = 'expense-uuid-1'

function makeRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/admin/financial/payables/${EXPENSE_ID}/pay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid-token' },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/financial/payables/[id]/pay', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ amount: 100, payment_date: '2026-06-18' }), {
      params: Promise.resolve({ id: EXPENSE_ID }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when financial scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ amount: 100, payment_date: '2026-06-18' }), {
      params: Promise.resolve({ id: EXPENSE_ID }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 400 when amount is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ payment_date: '2026-06-18' }), { params: Promise.resolve({ id: EXPENSE_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/amount and payment_date are required/i)
  })

  it('returns 400 when payment_date is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ amount: 100 }), { params: Promise.resolve({ id: EXPENSE_ID }) })
    expect(res.status).toBe(400)
  })

  it('returns validation error when parseBody fails', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const errorResponse = new Response(JSON.stringify({ error: 'Validation failed' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errorResponse } as any)
    const res = await POST(makeRequest({ amount: -50, payment_date: '2026-06-18', paymentMethod: 'cash' }), {
      params: Promise.resolve({ id: EXPENSE_ID }),
    })
    expect(res.status).toBe(422)
  })

  it('returns 404 when expense not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeRequest({ amount: 100, payment_date: '2026-06-18', paymentMethod: 'cash' }), {
      params: Promise.resolve({ id: EXPENSE_ID }),
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/expense not found/i)
  })

  it('records full payment and returns paid status', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    // First queryOne: expense lookup
    mockQueryOne
      .mockResolvedValueOnce({ id: EXPENSE_ID, total_amount: '500', status: 'unpaid' })
      // Second queryOne: sum of payments
      .mockResolvedValueOnce({ paid: '500' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await POST(makeRequest({ amount: 500, payment_date: '2026-06-18', payment_method: 'bank_transfer' }), {
      params: Promise.resolve({ id: EXPENSE_ID }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.new_status).toBe('paid')
    expect(body.total_paid).toBe(500)
  })

  it('records partial payment and returns partial status', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: EXPENSE_ID, total_amount: '1000', status: 'unpaid' })
      .mockResolvedValueOnce({ paid: '300' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await POST(makeRequest({ amount: 300, payment_date: '2026-06-18', payment_method: 'cash' }), {
      params: Promise.resolve({ id: EXPENSE_ID }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.new_status).toBe('partial')
  })

  it('returns unpaid status when paid total equals 0 after payment insert', async () => {
    // Note: the route checks `if (!amount || !payment_date)` — amount must be truthy.
    // A zero payment would be blocked by that guard; so this tests what happens when
    // the DB reports 0 total paid (e.g., the INSERT failed silently or was rolled back).
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: EXPENSE_ID, total_amount: '1000', status: 'unpaid' })
      .mockResolvedValueOnce({ paid: '0' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await POST(makeRequest({ amount: 1, payment_date: '2026-06-18', payment_method: 'cash' }), {
      params: Promise.resolve({ id: EXPENSE_ID }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.new_status).toBe('unpaid')
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne.mockRejectedValue(new Error('DB connection lost'))
    const res = await POST(makeRequest({ amount: 100, payment_date: '2026-06-18', paymentMethod: 'cash' }), {
      params: Promise.resolve({ id: EXPENSE_ID }),
    })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('DB connection lost')
  })
})
