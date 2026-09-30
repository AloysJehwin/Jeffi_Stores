import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', async () => {
  const { NextResponse } = await import('next/server')
  const { hasScope } = await vi.importActual<typeof import('@/lib/scopes')>('@/lib/scopes')
  const authenticateAdmin = vi.fn()
  return {
    authenticateAdmin,
    requireAdminScope: async (_req: unknown, scope: string | null) => {
      const admin = await authenticateAdmin()
      if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (scope && !hasScope(admin.role, admin.scopes, scope)) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }
      return admin
    },
  }
})
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendOrderStatusUpdate: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn(),
  isRazorpayEnabled: vi.fn().mockReturnValue(false),
}))
vi.mock('@/lib/delhivery', () => ({
  cancelDelhiveryShipment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/orders/[id]/cancel-review/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as razorpayLib from '@/lib/razorpay'

const ADMIN = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['orders:write'] }
const PARAMS = { params: Promise.resolve({ id: 'order-123' }) }

const MOCK_ORDER = {
  id: 'order-123',
  order_number: 'ORD-001',
  status: 'cancel_requested',
  payment_status: 'unpaid',
  total_amount: '500',
  customer_name: 'Test User',
  customer_email: 'test@example.com',
  user_id: 'user-1',
  awb_number: null,
  users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/orders/order-123/cancel-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/orders/[id]/cancel-review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
      return fn(client)
    })
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the admin lacks orders:write', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue({ ...ADMIN, role: 'viewer', scopes: ['orders:read'] } as any)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid action', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    const res = await POST(makeRequest({ action: 'invalid' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid action/i)
  })

  it('returns 400 when rejecting without a note', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    const res = await POST(makeRequest({ action: 'reject', note: '' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/reason is required/i)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 400 when order status is not cancel_requested', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER, status: 'pending' })
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not pending cancellation/i)
  })

  it('approves cancellation for unpaid order', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER).mockResolvedValueOnce(null) // no sale record
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('cancelled')
  })

  it('approves cancellation for paid order (leaves payment_status paid)', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    const mockRefund = vi.fn().mockResolvedValue({ id: 'refund_1' })
    vi.mocked(razorpayLib.getRazorpayInstance).mockReturnValue({
      payments: { refund: mockRefund },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, payment_status: 'paid' })
      .mockResolvedValueOnce(null) // no sale record
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('cancelled')
  })

  it('approves a paid-order cancellation without refunding (refund is a separate step)', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    const mockRefund = vi.fn().mockResolvedValue({ id: 'refund_1' })
    vi.mocked(razorpayLib.getRazorpayInstance).mockReturnValue({
      payments: { refund: mockRefund },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, payment_status: 'paid' })
      .mockResolvedValueOnce(null) // no sale record
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.newStatus).toBe('cancelled')
    // Cancel-review no longer issues the refund — it is deferred to /refund.
    expect(mockRefund).not.toHaveBeenCalled()
    const sqls = vi.mocked(db.query).mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => /payment_status = 'refunded'/.test(s))).toBe(false)
  })

  it('rejects cancellation with a note', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await POST(makeRequest({ action: 'reject', note: 'Cannot cancel shipped order' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('cancel_rejected')
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
