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
const PARAMS = { params: Promise.resolve({ id: 'order-123' }) }

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

  // --- approve: order has no user_id (skips createAutoTask + logActivity) ---

  it('approves return for guest order (no user_id)', async () => {
    const guestOrder = { ...MOCK_ORDER, user_id: null, users: null }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(guestOrder)
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.newStatus).toBe('return_approved')
  })

  // --- approve: email falls back to customer_email when users object is null ---

  it('approves return and uses customer_email fallback when users is null', async () => {
    const guestOrder = { ...MOCK_ORDER, users: null, customer_name: 'Guest User', customer_email: 'guest@example.com' }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(guestOrder)
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  // --- reject: no user_id (skips logActivity) ---

  it('rejects return for guest order (no user_id)', async () => {
    const guestOrder = { ...MOCK_ORDER, user_id: null, users: null }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(guestOrder)
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'reject', adminNotes: 'Not eligible' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.newStatus).toBe('return_rejected')
  })

  // --- mark_received: no user_id (skips createAutoTask + logActivity) ---

  it('marks return received for guest order (no user_id)', async () => {
    const guestOrder = { ...MOCK_ORDER, status: 'return_approved', user_id: null, users: null }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(guestOrder)
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'mark_received' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.newStatus).toBe('return_received')
  })

  // --- process/refund: Razorpay enabled but no payment record found (falls through) ---

  it('processes refund when razorpay enabled but no payment record — falls through to manual path', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockReturnValue(true)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
      .mockResolvedValueOnce(null) // no payment record
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('returned')
    expect(body.refundFailed).toBe(false)
  })

  // --- process/refund: Razorpay enabled but payment record has no transaction_id ---

  it('processes refund when payment record has no transaction_id — falls through to manual path', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockReturnValue(true)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
      .mockResolvedValueOnce({ id: 'pmt-1', transaction_id: null, amount: '500', gateway_response: '{}' })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refundFailed).toBe(false)
  })

  // --- process/refund: original_order_id set — fetches payment_status from parent order ---

  it('processes refund with original_order_id — looks up parent payment_status', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockReturnValue(false)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid', original_order_id: 'parent-order-1' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
      .mockResolvedValueOnce({ payment_status: 'paid' }) // parent order payment_status
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.newStatus).toBe('returned')
  })

  // --- process/refund: restock=true (default) with variant items ---

  it('processes refund with restock — restocks variant items', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockReturnValue(false)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({
          rows: [{ product_id: 'p1', variant_id: 'v1', quantity: '2' }],
        }),
      }
      return fn(client)
    })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  // --- process/refund: no user_id (skips logActivity) ---

  it('processes refund for guest order (no user_id)', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockReturnValue(false)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', user_id: null, users: null })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.newStatus).toBe('returned')
  })

  // --- process/refund: razorpay success + original_order_id (updates parent payment_status) ---

  it('processes razorpay refund and updates parent order when original_order_id is set', async () => {
    const razorpayMock = {
      payments: { refund: vi.fn().mockResolvedValue({ id: 'rfnd_456' }) },
    }
    vi.mocked(razorpayLib.isRazorpayEnabled).mockReturnValue(true)
    vi.mocked(razorpayLib.getRazorpayInstance).mockReturnValue(razorpayMock as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid', original_order_id: 'parent-order-1' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
      .mockResolvedValueOnce({ payment_status: 'paid' }) // parent payment_status lookup
      .mockResolvedValueOnce({ id: 'pmt-1', transaction_id: 'pay_abc', amount: '500', gateway_response: '{}' })
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      }
      return fn(client)
    })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refundFailed).toBe(false)
  })

  // --- process/replacement: restock=false skips inventory update ---

  it('processes replacement with restock=false — skips return-stock update', async () => {
    const replacementReturnRequest = { ...MOCK_RETURN_REQUEST, type: 'replacement' }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(replacementReturnRequest)
      .mockResolvedValueOnce({ ...MOCK_ORDER, shipping_address_snapshot: null })
      .mockResolvedValueOnce({ items: [{ product_id: 'p1', variant_id: 'v1', quantity: '1', product_name: 'X', variant_name: 'Y', unit_price: '100', total_price: '100', buy_mode: 'retail', buy_unit: 'piece' }] })
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'new-order-id', order_number: 'RPL-ORD-001' }],
        }),
      }
      return fn(client)
    })
    const res = await POST(makeRequest({ action: 'process', restock: false }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.newStatus).toBe('returned')
    expect(body.replacementOrderId).toBe('new-order-id')
  })

  // --- process/replacement: no user_id (skips logActivity) ---

  it('processes replacement for guest order (no user_id)', async () => {
    const replacementReturnRequest = { ...MOCK_RETURN_REQUEST, type: 'replacement' }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', user_id: null, users: null })
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
    expect(body.newStatus).toBe('returned')
  })

  // --- process: return type is neither refund nor replacement → 400 Unhandled action ---

  it('returns 400 when process action has unknown return type', async () => {
    const unknownTypeRequest = { ...MOCK_RETURN_REQUEST, type: 'exchange' }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(unknownTypeRequest)
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Unhandled action/i)
  })

  // --- missing action field ---

  it('returns 400 when action is missing', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    const res = await POST(makeRequest({}) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid action/i)
  })

  // --- reject: adminNotes is only whitespace ---

  it('returns 400 when adminNotes is only whitespace for reject', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    const res = await POST(makeRequest({ action: 'reject', adminNotes: '   ' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Admin notes are required/i)
  })
})
