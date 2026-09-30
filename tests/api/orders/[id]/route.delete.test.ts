import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendOrderStatusUpdate: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/invoice', () => ({
  generateOrderInvoice: vi.fn().mockResolvedValue(Buffer.from('inv')),
  assignInvoiceNumber: vi.fn().mockResolvedValue('JS/26-27/999'),
}))
vi.mock('@/lib/delhivery', () => ({
  cancelDelhiveryShipment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn(),
  isRazorpayEnabled: vi.fn().mockReturnValue(false),
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
vi.mock('@/lib/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({ inventoryValidationEnabled: true }),
}))
vi.mock('@/lib/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { GET, PATCH, DELETE } from '@/app/api/orders/[id]/route'
import * as db from '@/lib/db'
import * as jwt from '@/lib/jwt'
import * as inventoryDeduct from '@/lib/inventory-deduct'

const PARAMS = { params: Promise.resolve({ id: 'order-1' }) }
const USER = { userId: 'user-1', isBusiness: false }
const BIZ_USER = { userId: 'biz-1', isBusiness: true }
const ADMIN = { adminId: 'admin-1', username: 'root', role: 'super_admin', scopes: [] }

function makeReq(method: string, body?: any, headers: Record<string, string> = {}) {
  const init: any = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  return new Request('http://localhost/api/orders/order-1', init)
}

const BASE_ORDER: any = {
  id: 'order-1',
  order_number: 'ORD-1',
  status: 'pending',
  payment_status: 'unpaid',
  total_amount: '500',
  invoice_number: null,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  notes: null,
  order_type: 'cart',
  user_id: 'user-1',
  subtotal: '500',
  tax_amount: '50',
  discount_amount: '0',
  business_discount_amount: '0',
  shipping_amount: '0',
  payment_mode: 'manual',
  shipping_address: null,
  estimated_delivery_date: null,
  delivered_at: null,
  original_order_id: null,
  original_order_number: null,
  view_token: null,
  razorpay_qr_image_url: null,
  tracking_url: null,
  awb_number: null,
}

describe('DELETE /api/orders/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await DELETE(makeReq('DELETE') as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await DELETE(makeReq('DELETE') as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 400 when order is not pending', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1',
      status: 'confirmed',
      payment_status: 'unpaid',
      committed_payment_count: 0,
    })
    const res = await DELETE(makeReq('DELETE') as any, PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 when committed payments exist', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1',
      status: 'pending',
      payment_status: 'unpaid',
      committed_payment_count: 1,
    })
    const res = await DELETE(makeReq('DELETE') as any, PARAMS)
    expect(res.status).toBe(400)
  })

  it('re-populates cart with UPDATE when matching cart item exists', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        id: 'order-1',
        status: 'pending',
        payment_status: 'unpaid',
        committed_payment_count: 0,
      })
      .mockResolvedValueOnce({ id: 'existing-cart' }) // existing cart_item lookup
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      {
        product_id: 'p1',
        variant_id: null,
        sub_variant_id: null,
        quantity: '3',
        unit_price: '100',
        buy_mode: 'unit',
        buy_unit: null,
      },
    ])
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await DELETE(makeReq('DELETE') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.deleted).toBe(true)
    // Should have called UPDATE cart_items then DELETE FROM orders
    const sqls = vi.mocked(db.query).mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => /UPDATE cart_items/i.test(s))).toBe(true)
    expect(sqls.some(s => /DELETE FROM orders/i.test(s))).toBe(true)
  })

  it('re-populates cart with INSERT when no matching cart item', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        id: 'order-1',
        status: 'pending',
        payment_status: 'unpaid',
        committed_payment_count: 0,
      })
      .mockResolvedValueOnce(null) // no matching cart_item
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      {
        product_id: 'p1',
        variant_id: null,
        sub_variant_id: null,
        quantity: '3',
        unit_price: '100',
        buy_mode: 'unit',
        buy_unit: null,
      },
    ])
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await DELETE(makeReq('DELETE') as any, PARAMS)
    expect(res.status).toBe(200)
    const sqls = vi.mocked(db.query).mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => /INSERT INTO cart_items/i.test(s))).toBe(true)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockRejectedValue(new Error('boom'))
    const res = await DELETE(makeReq('DELETE') as any, PARAMS)
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/orders/[id] cart restore', () => {
  const AUTH_USER = { userId: 'user-456', email: 'test@example.com', isBusiness: false }
  const PARAMS = { params: Promise.resolve({ id: 'order-123' }) }

  function makeDeleteRequest() {
    return new Request('http://localhost/api/orders/order-123', { method: 'DELETE' })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await DELETE(makeDeleteRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 404 when order is not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue(null)

    const res = await DELETE(makeDeleteRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 400 when order cannot be deleted (not pending/unpaid)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-123',
      status: 'confirmed',
      payment_status: 'paid',
      committed_payment_count: 1,
    })

    const res = await DELETE(makeDeleteRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/cannot be deleted/i)
  })

  it('restores order items to cart on delete (existing cart item)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        id: 'order-123',
        status: 'pending',
        payment_status: 'unpaid',
        committed_payment_count: 0,
      })
      .mockResolvedValueOnce({ id: 'ci-existing' }) // existing cart item found
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      {
        product_id: 'prod-1',
        variant_id: null,
        sub_variant_id: null,
        quantity: '2',
        unit_price: '100',
        buy_mode: 'unit',
        buy_unit: null,
      },
    ])
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await DELETE(makeDeleteRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('restores order items to cart on delete (new cart item insert)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        id: 'order-123',
        status: 'pending',
        payment_status: 'unpaid',
        committed_payment_count: 0,
      })
      .mockResolvedValueOnce(null) // no existing cart item
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      {
        product_id: 'prod-1',
        variant_id: null,
        sub_variant_id: null,
        quantity: '1',
        unit_price: '200',
        buy_mode: 'unit',
        buy_unit: null,
      },
    ])
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await DELETE(makeDeleteRequest() as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('deletes order with no items and returns deleted=true', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-123',
      status: 'pending',
      payment_status: 'unpaid',
      committed_payment_count: 0,
    })
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await DELETE(makeDeleteRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.deleted).toBe(true)
  })
})
