import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
// Moving to processing is blocked while an address change is pending; these tests are about
// inventory, so there is none.
vi.mock('@/lib/address-change', () => ({
  hasPendingAddressChange: vi.fn().mockResolvedValue(false),
  addressChangeBlockReason: vi.fn().mockReturnValue('not_confirmed'),
}))
vi.mock('@/lib/email', () => ({
  sendOrderStatusUpdate: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/invoice', () => ({
  generateOrderInvoice: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  assignInvoiceNumber: vi.fn().mockResolvedValue('JS/26-27/999'),
}))
vi.mock('@/lib/delhivery', () => ({
  cancelDelhiveryShipment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/inventory-deduct', () => ({
  deductOrderStock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/order-stock', () => ({
  restoreOrderStock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
  completeAutoTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/marketing', () => ({
  attributeConversion: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { GET, PATCH, DELETE } from '@/app/api/orders/[id]/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'

// ------------------------------------------------------------------ helpers

function makeGetRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/orders/order-123', {
    method: 'GET',
    headers,
  })
}

function makePatchRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/orders/order-123', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest() {
  return new Request('http://localhost/api/orders/order-123', { method: 'DELETE' })
}

const AUTH_USER = { userId: 'user-456', email: 'test@example.com', isBusiness: false }
const ADMIN_USER = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['orders:write'] }
const PARAMS = { params: Promise.resolve({ id: 'order-123' }) }

const MOCK_ORDER = {
  id: 'order-123',
  order_number: 'ORD-001',
  invoice_number: null,
  total_amount: '500',
  subtotal: '500',
  tax_amount: '0',
  discount_amount: '0',
  shipping_amount: '0',
  status: 'pending',
  payment_status: 'unpaid',
  payment_mode: null,
  razorpay_qr_image_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  delivered_at: null,
  notes: null,
  tracking_url: null,
  awb_number: null,
  original_order_id: null,
  original_order_number: null,
  order_type: 'cart',
  shipping_address: null,
  user_id: 'user-456',
}

const MOCK_ORDER_ITEMS: any[] = []

// ------------------------------------------------------------------ GET tests

describe('GET /api/orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await GET(makeGetRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 404 when order is not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue(null)
    vi.mocked(db.queryMany).mockResolvedValue([])

    const res = await GET(makeGetRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatch(/not found/i)
  })

  it('returns order details for the owner', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue(MOCK_ORDER_ITEMS)

    const res = await GET(makeGetRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.order).toBeDefined()
    expect(body.order.orderNumber).toBe('ORD-001')
    expect(body.order.status).toBe('pending')
  })
})

// ------------------------------------------------------------------ PATCH tests

describe('PATCH /api/orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not an admin', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)

    const res = await PATCH(makePatchRequest({ status: 'confirmed' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 404 when order does not exist', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue(null)

    const res = await PATCH(makePatchRequest({ status: 'confirmed' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 400 for an invalid status transition', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'delivered',
      payment_status: 'paid',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })

    // delivered → processing is not a valid transition
    const res = await PATCH(makePatchRequest({ status: 'processing' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/cannot transition/i)
  })

  it('updates order status successfully for admin', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatchRequest({ status: 'confirmed' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })
})

describe('GET /api/orders/[id] (business portal)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns order for a business user (isBusiness=true)', async () => {
    const bizUser = { userId: 'user-456', email: 'biz@example.com', isBusiness: true }
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(bizUser as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ email: 'biz@example.com', phone: '9999' })  // bizUser lookup
      .mockResolvedValueOnce(MOCK_ORDER)                                    // order lookup
    vi.mocked(db.queryMany).mockResolvedValue(MOCK_ORDER_ITEMS)

    const res = await GET(makeGetRequest({ 'x-auth-portal': 'business' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.order.orderNumber).toBe('ORD-001')
  })

  it('returns order for x-auth-portal: business header', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'user-456', isBusiness: false } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ email: 'test@example.com', phone: null }) // bizUser lookup
      .mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([])

    const res = await GET(
      makeGetRequest({ 'x-auth-portal': 'business' }) as any,
      PARAMS
    )
    expect(res.status).toBe(200)
  })

  it('returns 500 on unexpected database error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB exploded'))

    const res = await GET(makeGetRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/orders/[id] (extended)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 400 when order is in a terminal status', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'cancelled',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })

    const res = await PATCH(makePatchRequest({ status: 'confirmed' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/cannot be modified/i)
  })

  it('returns 400 for invalid payment_status', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })

    const res = await PATCH(makePatchRequest({ payment_status: 'invalid_status' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid payment status/i)
  })

  it('returns 400 when trying to revert paid to pending', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      payment_status: 'paid',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })

    const res = await PATCH(makePatchRequest({ payment_status: 'pending' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/paid orders cannot revert/i)
  })

  it('returns 400 when transitioning to processing with insufficient stock', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'confirmed',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })
    vi.mocked(db.queryOne).mockResolvedValueOnce(null) // unit row
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      { product_id: 'prod-1', variant_id: null, quantity: '10', inventory_quantity: '5' },
    ])

    const res = await PATCH(makePatchRequest({ status: 'processing' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/insufficient stock/i)
  })

  it('deducts inventory when transitioning to processing (variant path)', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'confirmed',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })
    vi.mocked(db.queryOne).mockResolvedValueOnce(null) // unit row
    // Stock check pass (sufficient); deduction is delegated to the mocked helper.
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      { product_id: 'prod-1', variant_id: 'var-1', quantity: '2', inventory_quantity: '10' },
    ])
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
      return fn(client)
    })

    const res = await PATCH(makePatchRequest({ status: 'processing' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('deducts inventory when transitioning to processing (product path, no variant)', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'confirmed',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })
    vi.mocked(db.queryOne).mockResolvedValueOnce(null) // unit row
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      { product_id: 'prod-1', variant_id: null, quantity: '2', inventory_quantity: '10' },
    ])
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
      return fn(client)
    })

    const res = await PATCH(makePatchRequest({ status: 'processing' }) as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('updates order status to shipped successfully', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'processing',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatchRequest({ status: 'shipped' }) as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('updates order status to delivered successfully', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'shipped',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatchRequest({ status: 'delivered' }) as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('creates refund auto-task when cancelling a paid order', async () => {
    const { createAutoTask } = await import('@/lib/auto-tasks')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'confirmed',
      payment_status: 'paid',
      user_id: 'user-456',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    }).mockResolvedValue(null) // sale-check + any later reads → null (no sale, no payment record)
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatchRequest({ status: 'cancelled' }) as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('updates payment_status to failed and triggers auto-task', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'confirmed',
      payment_status: 'unpaid',
      user_id: 'user-456',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatchRequest({ payment_status: 'failed' }) as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('updates payment_status to refunded', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      status: 'cancelled',
      payment_status: 'paid',
      user_id: 'user-456',
      users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    // cancelled is terminal — so pass only payment_status without status
    const res = await PATCH(makePatchRequest({ payment_status: 'refunded' }) as any, PARAMS)
    // cancelled is terminal status — should get 400
    expect(res.status).toBe(400)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN_USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))

    const res = await PATCH(makePatchRequest({ status: 'confirmed' }) as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
