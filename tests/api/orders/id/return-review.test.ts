import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendReturnStatusEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn(),
  isRazorpayEnabled: vi.fn().mockReturnValue(false),
}))
vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
  completeAutoTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/orders/[id]/return-review/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as razorpayLib from '@/lib/razorpay'

const ADMIN = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: [] }
const PARAMS = { params: { id: 'order-123' } }

const MOCK_ORDER = {
  id: 'order-123',
  order_number: 'ORD-001',
  status: 'return_requested',
  payment_status: 'paid',
  total_amount: '500',
  customer_name: 'Test User',
  customer_email: 'test@example.com',
  user_id: 'user-1',
  original_order_id: null,
  users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
}

const MOCK_RETURN_REQUEST = {
  id: 'rr-1',
  order_id: 'order-123',
  user_id: 'user-1',
  type: 'refund',
  reason: 'defective',
  status: 'pending',
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/orders/order-123/return-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/orders/[id]/return-review', () => {
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

  it('returns 400 for invalid action', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    const res = await POST(makeRequest({ action: 'invalid' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid action/i)
  })

  it('returns 400 when rejecting without adminNotes', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    const res = await POST(makeRequest({ action: 'reject', adminNotes: '' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Admin notes are required/i)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 404 when no active return request found', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/No active return request/i)
  })

  it('returns 400 when approving but order not in return_requested status', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'delivered' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Cannot approve/i)
  })

  it('approves a return request successfully', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'approve', adminNotes: 'OK' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('return_approved')
  })

  it('rejects a return request with notes', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'reject', adminNotes: 'Not eligible' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('return_rejected')
  })

  it('returns 400 when mark_received but order not return_approved', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_requested' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'mark_received' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Cannot mark received/i)
  })

  it('marks return received successfully', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_approved' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'mark_received', returnTrackingNumber: 'TRK123' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('return_received')
  })

  it('returns 400 when processing but order not return_received', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_approved' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Cannot process/i)
  })

  it('processes a refund return (no razorpay) successfully', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(razorpayLib.isRazorpayEnabled).mockReturnValue(false)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('returned')
  })

  it('processes replacement return and creates new order', async () => {
    const replacementReturnRequest = { ...MOCK_RETURN_REQUEST, type: 'replacement' }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(replacementReturnRequest)
      .mockResolvedValueOnce({ ...MOCK_ORDER, shipping_address_snapshot: null })
      .mockResolvedValueOnce({ items: [] })
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'new-order-id', order_number: 'RPL-ORD-001' }],
        }),
      }
      return fn(client)
    })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('returned')
  })

  it('returns 400 when rejecting an order not in return_requested status', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'delivered' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'reject', adminNotes: 'Not eligible' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Cannot reject/i)
  })

  it('processes refund with razorpay enabled and payment record present', async () => {
    const razorpayMock = {
      payments: { refund: vi.fn().mockResolvedValue({ id: 'rfnd_123' }) },
    }
    vi.mocked(razorpayLib.isRazorpayEnabled).mockReturnValue(true)
    vi.mocked(razorpayLib.getRazorpayInstance).mockReturnValue(razorpayMock as any)

    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid', original_order_id: null })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
      .mockResolvedValueOnce({ id: 'pmt-1', transaction_id: 'pay_abc', amount: '500', gateway_response: '{}' })

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [{ product_id: 'p1', variant_id: null, quantity: '1' }] }),
      }
      return fn(client)
    })

    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('returned')
  })

  it('processes refund without razorpay — restock=false skips inventory update', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockReturnValue(false)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      }
      return fn(client)
    })

    const res = await POST(makeRequest({ action: 'process', restock: false }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('returned')
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
