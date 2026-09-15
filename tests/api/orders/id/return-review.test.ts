import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  queryMany: vi.fn().mockResolvedValue([]),
  withTransaction: vi.fn(),
  resolveRequestTenant: vi.fn().mockResolvedValue(null),
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
  getRazorpayInstanceFor: vi.fn(),
  isRazorpayEnabled: vi.fn().mockReturnValue(false),
}))
vi.mock('@/lib/razorpay-route', () => ({
  reverseTransfersForRefund: vi.fn().mockResolvedValue({ reversedPaise: 0, unrecoveredPaise: 0, perTransfer: [] }),
  recordRefundSettlement: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}))
vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
  completeAutoTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/order-stock', () => ({
  restoreOrderStock: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/orders/[id]/return-review/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as razorpayLib from '@/lib/razorpay'
import * as razorpayRoute from '@/lib/razorpay-route'
import * as inventory from '@/lib/inventory'
import * as email from '@/lib/email'
import * as activity from '@/lib/activity'
import * as autoTasks from '@/lib/auto-tasks'
import * as orderStock from '@/lib/order-stock'

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
    vi.mocked(db.queryMany).mockResolvedValue([])
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
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
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
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: razorpayMock } as any)

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
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
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
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
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
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
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

  // Regression: a partial return refunded the buyer but never reversed the tenant's Route
  // share, so the platform absorbed the whole refund on every returned order.
  it('claws back the tenant Route share on a return refund', async () => {
    const razorpayMock = { payments: { refund: vi.fn().mockResolvedValue({ id: 'rfnd_1' }) } }
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true as any)
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: razorpayMock } as any)
    vi.mocked(db.resolveRequestTenant).mockResolvedValue({ tenantId: 'tnt-1', slug: 't' } as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid', original_order_id: null })
      .mockResolvedValueOnce({ id: 'rr-1', type: 'refund', status: 'received', order_id: 'order-123' })
      .mockResolvedValueOnce({ id: 'pmt-1', transaction_id: 'pay_abc', amount: '500', gateway_response: '{}' })
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) =>
      fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))

    await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(razorpayRoute.reverseTransfersForRefund).toHaveBeenCalled()
  })

  // --- process/refund: original_order_id set — fetches payment_status from parent order ---

  it('processes refund with original_order_id — looks up parent payment_status', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
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
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
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
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
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
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: razorpayMock } as any)
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

  // --- process/refund: item-level records present → refundAmount computed via reduce (line 212) ---

  it('processes refund using item-level records (sums refund_amount)', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    // item-level return records → useItemLevel = true, reduce runs
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      { refund_amount: '100.50', quantity: '1', unit_price: '100.50', product_id: 'p1', variant_id: null, product_name: 'Widget' },
      { refund_amount: '49.50', quantity: '1', unit_price: '49.50', product_id: 'p2', variant_id: null, product_name: 'Gadget' },
    ])
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('returned')
  })

  // --- process/refund: razorpay refund throws → catch sets refundFailed (line 285) ---

  it('marks refundFailed when razorpay refund throws', async () => {
    const razorpayMock = {
      payments: { refund: vi.fn().mockRejectedValue(new Error('gateway down')) },
    }
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: razorpayMock } as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid', original_order_id: null })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
      .mockResolvedValueOnce({ id: 'pmt-1', transaction_id: 'pay_abc', amount: '500', gateway_response: '{}' })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    // fell through to manual path, refundFailed flagged true
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('returned')
    expect(body.refundFailed).toBe(true)
  })

  // --- process/refund: gateway_response as object (not string) — JSON.parse branch not taken ---

  it('processes razorpay refund with object gateway_response', async () => {
    const razorpayMock = {
      payments: { refund: vi.fn().mockResolvedValue({ id: 'rfnd_obj' }) },
    }
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: razorpayMock } as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid', original_order_id: null })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
      .mockResolvedValueOnce({ id: 'pmt-1', transaction_id: 'pay_abc', amount: '500', gateway_response: { existing: true } })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refundFailed).toBe(false)
  })

  // --- process/refund: gateway_response is null — `|| {}` fallback branch ---

  it('processes razorpay refund with null gateway_response', async () => {
    const razorpayMock = {
      payments: { refund: vi.fn().mockResolvedValue({ id: 'rfnd_null' }) },
    }
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: razorpayMock } as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid', original_order_id: null })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
      .mockResolvedValueOnce({ id: 'pmt-1', transaction_id: 'pay_abc', amount: '500', gateway_response: null })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refundFailed).toBe(false)
  })

  // --- process/replacement: item-level items → loop body runs (lines 377-406) with variant + product branches ---

  it('processes replacement with item-level items (variant + product stock updates)', async () => {
    const replacementReturnRequest = { ...MOCK_RETURN_REQUEST, type: 'replacement' }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(replacementReturnRequest)
      .mockResolvedValueOnce({ ...MOCK_ORDER, shipping_address_snapshot: { full_name: 'Snap User', address_line1: 'L1' } })
      // v1 is still an active variant → no variant pick needed
      .mockResolvedValueOnce({ is_active: true })
    // item-level records → replacementItems = returnItems, loop executes both branches
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      { refund_amount: '200', quantity: '2', unit_price: '100', product_id: 'p1', variant_id: 'v1', product_name: 'Variant Item', variant_name: 'Red', buy_mode: 'unit', buy_unit: null },
      { refund_amount: '50', quantity: '1', unit_price: '50', product_id: 'p2', variant_id: null, product_name: 'Plain Item', variant_name: null, buy_mode: null, buy_unit: null },
    ])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [{ id: 'new-order-id', order_number: 'RPL-ORD-001' }] }),
      }
      return fn(client)
    })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.newStatus).toBe('returned')
    expect(body.replacementOrderId).toBe('new-order-id')
    // logStockMovement called once per item
    expect(vi.mocked(inventory.logStockMovement)).toHaveBeenCalledTimes(2)
  })

  // --- process/replacement: legacy (no item-level) → queryMany order_items fallback loop ---

  it('processes replacement falling back to all order_items (legacy, no item-level)', async () => {
    const replacementReturnRequest = { ...MOCK_RETURN_REQUEST, type: 'replacement' }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(replacementReturnRequest)
      .mockResolvedValueOnce({ ...MOCK_ORDER, shipping_address_snapshot: null })
    // first queryMany (return_request_items) empty → useItemLevel false
    // second queryMany (order_items) returns legacy items → loop runs
    vi.mocked(db.queryMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { quantity: '3', unit_price: '10', product_id: 'p9', variant_id: null, product_name: 'Legacy', variant_name: null, buy_mode: 'unit', buy_unit: null },
      ])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [{ id: 'legacy-new-order', order_number: 'RPL-ORD-001' }] }),
      }
      return fn(client)
    })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.replacementOrderId).toBe('legacy-new-order')
    expect(vi.mocked(inventory.logStockMovement)).toHaveBeenCalledTimes(1)
  })

  // --- approve: userEmail present but userName empty → email send skipped ---

  it('approves when userName resolves empty (email skipped)', async () => {
    const orderNoName = { ...MOCK_ORDER, users: { email: 'e@x.com', first_name: '', last_name: '' }, customer_name: '' }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(orderNoName)
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(200)
    // userName is '' (falsy) so sendReturnStatusEmail must NOT be called
    expect(vi.mocked(email.sendReturnStatusEmail)).not.toHaveBeenCalled()
  })

  // --- approve: replacement-type return request → activity summary says "Replacement" ---

  it('approves a replacement-type return (activity summary uses Replacement)', async () => {
    const replacementReq = { ...MOCK_RETURN_REQUEST, type: 'replacement' }
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(replacementReq)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect(vi.mocked(activity.logActivity)).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringMatching(/Replacement approved/),
      })
    )
  })
})

// --- Fire-and-forget side effects that reject: exercises every inline `.catch(() => {})` ---
// These callbacks are separate functions in v8's coverage; they only run when the awaited
// side-effect promise rejects. Each block drives one action path with all side effects failing.

describe('POST /api/orders/[id]/return-review — rejected side-effects hit .catch handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'new-order-id', order_number: 'RPL-ORD-001' }] }) }
      return fn(client)
    })
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    // Make every fire-and-forget dependency reject so its `.catch(() => {})` runs
    vi.mocked(email.sendReturnStatusEmail).mockRejectedValue(new Error('email fail'))
    vi.mocked(email.sendPaymentStatusUpdate).mockRejectedValue(new Error('email fail'))
    vi.mocked(autoTasks.createAutoTask).mockRejectedValue(new Error('task fail'))
    vi.mocked(autoTasks.completeAutoTask).mockRejectedValue(new Error('task fail'))
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('activity fail'))
    vi.mocked(orderStock.restoreOrderStock).mockRejectedValue(new Error('restock fail'))
  })

  it('approve path: swallows all rejected side effects', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'approve' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).newStatus).toBe('return_approved')
  })

  it('reject path: swallows all rejected side effects', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'reject', adminNotes: 'no' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).newStatus).toBe('return_rejected')
  })

  it('mark_received path: swallows all rejected side effects', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_approved' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'mark_received', returnTrackingNumber: 'TRK1' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).newStatus).toBe('return_received')
  })

  it('process refund (manual path): swallows all rejected side effects', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).newStatus).toBe('returned')
  })

  it('process refund (razorpay success path): swallows all rejected side effects', async () => {
    const razorpayMock = { payments: { refund: vi.fn().mockResolvedValue({ id: 'rfnd' }) } }
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: razorpayMock } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received', payment_status: 'paid' })
      .mockResolvedValueOnce(MOCK_RETURN_REQUEST)
      .mockResolvedValueOnce({ id: 'pmt-1', transaction_id: 'pay_abc', amount: '500', gateway_response: '{}' })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.newStatus).toBe('returned')
    expect(body.refundFailed).toBe(false)
  })

  it('process replacement path: swallows all rejected side effects', async () => {
    const replacementReturnRequest = { ...MOCK_RETURN_REQUEST, type: 'replacement' }
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'return_received' })
      .mockResolvedValueOnce(replacementReturnRequest)
      .mockResolvedValueOnce({ ...MOCK_ORDER, shipping_address_snapshot: null })
    const res = await POST(makeRequest({ action: 'process' }) as any, PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).newStatus).toBe('returned')
  })
})
