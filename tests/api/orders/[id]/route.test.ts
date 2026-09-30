import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', async () => {
  const { NextResponse } = await import('next/server')
  const { hasScope } = await vi.importActual<typeof import('@/lib/auth/scopes')>('@/lib/auth/scopes')
  const authenticateAdmin = vi.fn()
  return {
    authenticateAnyUser: vi.fn(),
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
vi.mock('@/lib/email', () => ({
  sendOrderStatusUpdate: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/documents/invoice', () => ({
  generateOrderInvoice: vi.fn().mockResolvedValue(Buffer.from('inv')),
  assignInvoiceNumber: vi.fn().mockResolvedValue('JS/26-27/999'),
}))
vi.mock('@/lib/shipping/delhivery', () => ({
  cancelDelhiveryShipment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/payments/razorpay', () => ({
  getRazorpayInstance: vi.fn(),
  isRazorpayEnabled: vi.fn().mockReturnValue(false),
}))
vi.mock('@/lib/orders/inventory-deduct', () => ({
  deductOrderStock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/orders/order-stock', () => ({
  restoreOrderStock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shared/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
  completeAutoTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shared/marketing', () => ({
  attributeConversion: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({ inventoryValidationEnabled: true }),
}))
vi.mock('@/lib/shared/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/shared/validate')>()
  return { ...actual }
})

import { GET, PATCH, DELETE } from '@/app/api/(public)/orders/[id]/route'
import * as db from '@/lib/shared/db'
import * as jwt from '@/lib/auth/jwt'
import * as inventoryDeduct from '@/lib/orders/inventory-deduct'

const PARAMS = { params: Promise.resolve({ id: 'order-1' }) }
const USER = { userId: 'user-1', isBusiness: false }
const BIZ_USER = { userId: 'biz-1', isBusiness: true }
const ADMIN = { adminId: 'admin-1', username: 'root', role: 'super_admin', scopes: ['orders:write'] }

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

describe('GET /api/orders/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await GET(makeReq('GET') as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when order not found for regular user', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await GET(makeReq('GET') as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 200 for a regular user order with items', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(BASE_ORDER)
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      {
        id: 'item-1',
        product_id: 'p1',
        product_name: 'P',
        product_sku: 'SKU',
        variant_name: null,
        quantity: '1',
        unit_price: '500',
        total_price: '500',
        buy_mode: 'unit',
        buy_unit: null,
        products: { slug: 'p', extra_delivery_days: 0 },
        return_allowed: true,
        return_window_days: '7',
        replacement_allowed: true,
        replacement_window_days: '7',
      },
    ])

    const res = await GET(makeReq('GET') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.id).toBe('order-1')
    expect(body.order.items).toHaveLength(1)
    expect(body.order.items[0].returnAllowed).toBe(true)
  })

  it('takes business branch when x-auth-portal=business header set', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'biz-1', isBusiness: false } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ email: 'biz@x.com', phone: '9999' }) // biz user lookup
      .mockResolvedValueOnce({ ...BASE_ORDER, id: 'order-1' }) // biz order query
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    const res = await GET(makeReq('GET', undefined, { 'x-auth-portal': 'business' }) as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('takes business branch when isBusiness flag is true', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(BIZ_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ email: 'a@b.com', phone: null }) // bizUser lookup with null phone
      .mockResolvedValueOnce(BASE_ORDER)
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    const res = await GET(makeReq('GET') as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('handles Date object estimated_delivery_date', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      estimated_delivery_date: new Date('2024-03-15T00:00:00Z'),
    })
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    const res = await GET(makeReq('GET') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.estimatedDeliveryDate).toBeTruthy()
  })

  it('handles string estimated_delivery_date', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      estimated_delivery_date: '2024-03-15T00:00:00Z',
    })
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    const res = await GET(makeReq('GET') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.estimatedDeliveryDate).toBe('2024-03-15')
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockRejectedValue(new Error('boom'))
    const res = await GET(makeReq('GET') as any, PARAMS)
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/orders/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not admin', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const res = await PATCH(makeReq('PATCH', {}) as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the admin lacks orders:write', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue({ ...ADMIN, role: 'viewer', scopes: ['orders:read'] } as any)
    const res = await PATCH(makeReq('PATCH', { status: 'confirmed' }) as any, PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when order missing', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await PATCH(makeReq('PATCH', { status: 'confirmed' }) as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('rejects modification of terminal orders', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'cancelled',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    const res = await PATCH(makeReq('PATCH', { status: 'confirmed' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cannot be modified/i)
  })

  it('rejects invalid status transition', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'pending',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    const res = await PATCH(makeReq('PATCH', { status: 'delivered' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cannot transition/i)
  })

  it('rejects invalid payment_status value', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    const res = await PATCH(makeReq('PATCH', { payment_status: 'garbage' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid payment/i)
  })

  it('rejects revert from paid to pending', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'confirmed',
      payment_status: 'paid',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    const res = await PATCH(makeReq('PATCH', { payment_status: 'pending' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/paid orders cannot revert/i)
  })

  it('rejects processing when stock is insufficient', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE_ORDER,
        status: 'confirmed',
        users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
      })
      .mockResolvedValueOnce(null) // unitRow (no product_units row)
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      {
        product_id: 'p1',
        variant_id: null,
        sub_variant_id: null,
        quantity: '10',
        buy_unit: null,
        product_name: 'P',
        variant_name: null,
        inventory_quantity: 3,
      },
    ])

    const res = await PATCH(makeReq('PATCH', { status: 'processing' }) as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient stock/i)
  })

  it('processes shipped status update (adds shipped_at)', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'processing',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    const res = await PATCH(makeReq('PATCH', { status: 'shipped' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const called = (vi.mocked(db.query).mock.calls[0]?.[0] || '') as string
    expect(called).toMatch(/shipped_at/i)
  })

  it('processes delivered status (sets delivered_at)', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'out_for_delivery',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    const res = await PATCH(makeReq('PATCH', { status: 'delivered' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const called = (vi.mocked(db.query).mock.calls[0]?.[0] || '') as string
    expect(called).toMatch(/delivered_at/)
  })

  it('does NOT auto-refund or create a refund task when cancelling a paid order', async () => {
    const { createAutoTask } = await import('@/lib/shared/auto-tasks')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'confirmed',
      payment_status: 'paid',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await PATCH(makeReq('PATCH', { status: 'cancelled' }) as any, PARAMS)
    expect(res.status).toBe(200)
    // Allow any fire-and-forget side-effects to settle
    await new Promise(r => setTimeout(r, 10))
    // Refunding is now an explicit admin step via /api/orders/[id]/refund —
    // cancel must NOT create a process_refund task nor flip payment_status.
    expect(vi.mocked(createAutoTask).mock.calls.some(c => (c[0] as any)?.sourceKind === 'process_refund')).toBe(false)
    const sqls = vi.mocked(db.query).mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => /UPDATE orders SET payment_status = 'refunded'/.test(s))).toBe(false)
  })

  it('handles failed payment_status (creates contact_failed_payment task)', async () => {
    const { createAutoTask } = await import('@/lib/shared/auto-tasks')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await PATCH(makeReq('PATCH', { payment_status: 'failed' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 10))
    expect(vi.mocked(createAutoTask).mock.calls.some(c => (c[0] as any)?.sourceKind === 'contact_failed_payment')).toBe(
      true
    )
  })

  it('completes process_refund auto-task when payment_status → refunded', async () => {
    const { completeAutoTask } = await import('@/lib/shared/auto-tasks')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      payment_status: 'paid',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await PATCH(makeReq('PATCH', { payment_status: 'refunded' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 10))
    expect(vi.mocked(completeAutoTask).mock.calls.some(c => c[0] === 'process_refund')).toBe(true)
  })

  it('delegates deduction to the shared helper on transition to processing', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE_ORDER,
        status: 'confirmed',
        users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
      })
      .mockResolvedValueOnce(null) // pre-flight unitRow → passthrough qty
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      {
        product_id: 'p1',
        variant_id: null,
        sub_variant_id: null,
        quantity: '2',
        buy_unit: null,
        product_name: 'P',
        variant_name: null,
        inventory_quantity: 100,
      },
    ])
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) =>
      fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as any)
    )

    const batch_assignments = [
      {
        order_item_id: '22222222-2222-4222-8222-222222222222',
        batch_id: '11111111-1111-4111-8111-111111111111',
        qty: 2,
      },
    ]
    const serial_assignments = [{ order_item_id: '22222222-2222-4222-8222-222222222222', serial_number: 'SN-1' }]
    const res = await PATCH(
      makeReq('PATCH', { status: 'processing', batch_assignments, serial_assignments }) as any,
      PARAMS
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(db.withTransaction)).toHaveBeenCalled()
    // Deduction is delegated to the shared helper (one -1 ledger row per serial,
    // no double-deduct); picker assignments are forwarded verbatim.
    expect(vi.mocked(inventoryDeduct.deductOrderStock)).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({
        batchAssignments: batch_assignments,
        serialAssignments: serial_assignments,
        requireSerialAssignments: true,
      }),
      expect.anything()
    )
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAdmin).mockRejectedValue(new Error('boom'))
    const res = await PATCH(makeReq('PATCH', { status: 'confirmed' }) as any, PARAMS)
    expect(res.status).toBe(500)
  })

  it('rejects malformed body via zod (bad uuid in batch_assignments)', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    // parseBody fails schema before any order lookup
    const res = await PATCH(
      makeReq('PATCH', {
        status: 'processing',
        batch_assignments: [{ order_item_id: 'not-a-uuid', batch_id: 'nope', qty: 1 }],
      }) as any,
      PARAMS
    )
    expect(res.status).toBe(400)
  })
})
