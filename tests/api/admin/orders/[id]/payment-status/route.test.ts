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

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { PATCH } from '@/app/api/(admin)/admin/orders/[id]/payment-status/route'
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

  it('updates payment status to paid', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'order-1' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makeRequest('order-1', { payment_status: 'paid' }), {
      params: Promise.resolve({ id: 'order-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.payment_status).toBe('paid')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE orders'), ['paid', 'order-1'])
  })

  it.each(['unpaid', 'paid', 'partial', 'refunded'])('accepts valid status: %s', async status => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'order-1' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makeRequest('order-1', { payment_status: status }), {
      params: Promise.resolve({ id: 'order-1' }),
    })
    expect(res.status).toBe(200)
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
