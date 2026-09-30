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
  queryMany: vi.fn(),
  query: vi.fn(),
  resolveRequestTenant: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/email', () => ({
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstanceFor: vi.fn(),
  isRazorpayEnabled: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/razorpay-route', () => ({
  fetchTransfersForPayment: vi.fn().mockResolvedValue({ ok: true, transfers: [] }),
  fetchTransferIdForPayment: vi.fn().mockResolvedValue(null),
  reverseTransfer: vi.fn().mockResolvedValue(undefined),
  reverseTransfersForRefund: vi.fn().mockResolvedValue({ reversedPaise: 0, unrecoveredPaise: 0, perTransfer: [] }),
  recordRefundSettlement: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/orders/[id]/refund/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as razorpayLib from '@/lib/razorpay'
import * as razorpayRoute from '@/lib/razorpay-route'

const ADMIN = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['orders:write'] }
const PARAMS = { params: Promise.resolve({ id: 'order-123' }) }

const MOCK_ORDER = {
  id: 'order-123',
  order_number: 'ORD-001',
  status: 'cancelled',
  payment_status: 'paid',
  total_amount: '500',
  customer_name: 'Test User',
  customer_email: 'test@example.com',
  user_id: 'user-1',
  original_order_id: null,
  users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
}

const MOCK_PAYMENT = {
  id: 'pay-1',
  transaction_id: 'pay_rzp_123',
  amount: '500',
  gateway_response: '{}',
}

function makeRequest() {
  return new Request('http://localhost/api/orders/order-123/refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

describe('POST /api/orders/[id]/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    vi.mocked(db.queryMany).mockResolvedValue([] as any)
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
  })

  it('returns 401 when not admin', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the admin lacks orders:write', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue({ ...ADMIN, role: 'viewer', scopes: ['orders:read'] } as any)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 400 when order is not cancelled or returned', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER, status: 'pending' })
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cancelled or returned/i)
  })

  it('returns 400 when order not paid', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER, payment_status: 'unpaid' })
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not been paid/i)
  })

  it('returns 400 when razorpay not enabled', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not configured/i)
  })

  it('returns 400 when no payment record found', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValueOnce([] as any) // no completed payments
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    // isRazorpayEnabled passes, then payment records lookup returns none
    expect(body.error).toMatch(/No Razorpay payment record|not configured/i)
  })

  it('processes refund successfully', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValueOnce([MOCK_PAYMENT] as any)
    const mockRefund = vi.fn().mockResolvedValue({ id: 'rfnd_123' })
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({
      instance: { payments: { refund: mockRefund } },
    } as any)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // Refund now covers every completed payment; refundIds is an array.
    expect(body.refundIds).toEqual(['rfnd_123'])
    expect(body.totalRefunded).toBe(500)
    expect(mockRefund).toHaveBeenCalledWith('pay_rzp_123', { amount: 50000 })
  })

  it('processes refund for returned order', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER, status: 'returned' })
    vi.mocked(db.queryMany).mockResolvedValueOnce([MOCK_PAYMENT] as any)
    const mockRefund = vi.fn().mockResolvedValue({ id: 'rfnd_456' })
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({
      instance: { payments: { refund: mockRefund } },
    } as any)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refundIds).toEqual(['rfnd_456'])
  })

  it('returns 500 on razorpay gateway error', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValueOnce([MOCK_PAYMENT] as any)
    const mockRefund = vi.fn().mockRejectedValue(new Error('Gateway error'))
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({
      instance: { payments: { refund: mockRefund } },
    } as any)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })

  it('asks the shared helper to claw back the tenant share', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValueOnce([MOCK_PAYMENT] as any)
    const mockRefund = vi.fn().mockResolvedValue({ id: 'rfnd_123' })
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({
      instance: { payments: { refund: mockRefund } },
    } as any)
    vi.mocked(razorpayRoute.reverseTransfersForRefund).mockResolvedValue({
      reversedPaise: 386,
      unrecoveredPaise: 0,
      perTransfer: [{ transferId: 'trf_x', amountPaise: 386 }],
    })
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    // The helper owns the capping rule; the route passes the buyer amount and lets it cap.
    expect(razorpayRoute.reverseTransfersForRefund).toHaveBeenCalledWith('pay_rzp_123', 50000)
  })

  it('still refunds the buyer when the clawback cannot be recovered', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValueOnce([MOCK_PAYMENT] as any)
    const mockRefund = vi.fn().mockResolvedValue({ id: 'rfnd_123' })
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({
      instance: { payments: { refund: mockRefund } },
    } as any)
    // Linked account had no floating balance — Razorpay hard-fails the reversal.
    vi.mocked(razorpayRoute.reverseTransfersForRefund).mockResolvedValue({
      reversedPaise: 0,
      unrecoveredPaise: 386,
      perTransfer: [{ transferId: 'trf_z', amountPaise: 386, error: 'insufficient balance' }],
    })
    const res = await POST(makeRequest() as any, PARAMS)
    // The buyer is never held hostage to the tenant's balance.
    expect(res.status).toBe(200)
    expect(mockRefund).toHaveBeenCalled()
  })
})
