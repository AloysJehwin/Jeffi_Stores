import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn(),
  isRazorpayEnabled: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/orders/[id]/refund/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as razorpayLib from '@/lib/razorpay'

const ADMIN = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: [] }
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
    vi.mocked(razorpayLib.getRazorpayInstance).mockReturnValue({
      payments: { refund: mockRefund },
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
    vi.mocked(razorpayLib.getRazorpayInstance).mockReturnValue({
      payments: { refund: mockRefund },
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
    vi.mocked(razorpayLib.getRazorpayInstance).mockReturnValue({
      payments: { refund: mockRefund },
    } as any)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
