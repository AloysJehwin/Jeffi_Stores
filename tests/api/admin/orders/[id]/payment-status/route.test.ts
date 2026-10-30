import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
  isPlatformOwner: (role: string) => role === 'administrator' || role === 'super_admin',
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { PATCH } from '@controller/app/api/(admin)/admin/orders/[id]/payment-status/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['orders'],
}

function makeRequest(id = 'order-1', body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/admin/orders/${id}/payment-status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid' },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/orders/[id]/payment-status', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makeRequest('order-1', { payment_status: 'paid' }), {
      params: Promise.resolve({ id: 'order-1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makeRequest('order-1', { payment_status: 'paid' }), {
      params: Promise.resolve({ id: 'order-1' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid payment_status', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makeRequest('order-1', { payment_status: 'cancelled' }), {
      params: Promise.resolve({ id: 'order-1' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid payment_status/i)
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await PATCH(makeRequest('order-999', { payment_status: 'paid' }), {
      params: Promise.resolve({ id: 'order-999' }),
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  const ORDER = { id: 'order-1', order_number: 'ORD-1', status: 'confirmed', payment_status: 'unpaid' }
  const call = (body: Record<string, unknown>) =>
    PATCH(makeRequest('order-1', body), { params: Promise.resolve({ id: 'order-1' }) })

  it('updates payment status to paid and audits it', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(ORDER)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await call({ payment_status: 'paid', payment_mode: 'upi' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.payment_status).toBe('paid')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE orders'), ['paid', 'order-1'])
    const audit = mockQuery.mock.calls.find(c => String(c[0]).includes('admin_audit_log'))
    expect(audit).toBeDefined()
    expect(JSON.parse(String(audit![1]![6]))).toMatchObject({ payment_mode: 'upi' })
  })

  it('marks a partially paid invoice paid', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...ORDER, payment_status: 'partial' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    expect((await call({ payment_status: 'paid' })).status).toBe(200)
  })

  it('refuses a bare "refunded" without an override', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...ORDER, payment_status: 'paid' })
    const res = await call({ payment_status: 'refunded' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/refund/i)
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE orders'), expect.anything())
  })

  it('refuses a move outside the normal flow', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...ORDER, payment_status: 'paid' })
    const res = await call({ payment_status: 'unpaid' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Cannot move payment from 'paid' to 'unpaid'/)
  })

  it('refuses changes on a terminal order without an override', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...ORDER, status: 'cancelled' })
    const res = await call({ payment_status: 'paid' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cannot be modified/)
  })

  it('lets an owner override with a reason, and audits the override', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...ORDER, payment_status: 'paid' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await call({ payment_status: 'refunded', override: true, override_reason: 'Refunded by bank outside the app' })
    expect(res.status).toBe(200)
    const audit = mockQuery.mock.calls.find(c => String(c[0]).includes('admin_audit_log'))
    expect(JSON.parse(String(audit![1]![6]))).toMatchObject({ override: true, reason: 'Refunded by bank outside the app' })
  })

  it('refuses an override from a non-owner', async () => {
    mockAuth.mockResolvedValue({ ...adminPayload, role: 'admin' })
    mockHasScope.mockReturnValue(true)
    const res = await call({ payment_status: 'refunded', override: true, override_reason: 'Refunded by bank outside the app' })
    expect(res.status).toBe(403)
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('requires an override reason', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await call({ payment_status: 'unpaid', override: true, override_reason: 'short' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/override_reason/)
  })

  it('treats the same status as a no-op', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...ORDER, payment_status: 'paid' })
    const res = await call({ payment_status: 'paid' })
    expect(res.status).toBe(200)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns 500 on DB error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB down'))

    const res = await PATCH(makeRequest('order-1', { payment_status: 'paid' }), {
      params: Promise.resolve({ id: 'order-1' }),
    })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/DB down/i)
  })
})
