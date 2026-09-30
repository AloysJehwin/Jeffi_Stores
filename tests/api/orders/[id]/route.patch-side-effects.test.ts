import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/jwt', async () => {
  const { NextResponse } = await import('next/server')
  const authenticateAdmin = vi.fn()
  return {
    authenticateAnyUser: vi.fn(),
    authenticateAdmin,
    requireAdminScope: vi.fn(async (request: any) => {
      const admin = await authenticateAdmin(request)
      if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return admin
    }),
  }
})
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

// Exercises the fire-and-forget async paths (notify() closure and the razorpay
// refund IIFE) plus every `.catch(() => {})` swallow arrow. We make the library
// helpers reject so the catch arrows run, and await a macrotask so the detached
// promises settle before assertions.
describe('PATCH /api/orders/[id] async side-effects', () => {
  beforeEach(() => vi.clearAllMocks())

  async function flush() {
    // let detached promises (notify(), refund IIFE, .catch chains) settle
    await new Promise(r => setTimeout(r, 20))
  }

  it('does NOT issue a razorpay auto-refund on cancelling a paid order', async () => {
    const razorpay = await import('@/lib/razorpay')
    const email = await import('@/lib/email')
    const autoTasks = await import('@/lib/auto-tasks')

    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE_ORDER,
        status: 'confirmed',
        payment_status: 'paid',
        customer_email: 'c@x.com',
        customer_name: 'Cust',
        users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
      }) // currentOrder
      .mockResolvedValueOnce(null) // sale ledger check → no restore

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(razorpay.isRazorpayEnabled).mockResolvedValue(true)
    const refundFn = vi.fn().mockResolvedValue({ id: 'rfnd_1' })
    vi.mocked(razorpay.getRazorpayInstance).mockReturnValue({
      payments: { refund: refundFn },
    } as any)

    const res = await PATCH(makeReq('PATCH', { status: 'cancelled' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()

    // Auto-refund-on-cancel was removed — refunding is now an explicit admin step.
    expect(refundFn).not.toHaveBeenCalled()
    const sqls = vi.mocked(db.query).mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => /UPDATE payments SET status = 'refunded'/.test(s))).toBe(false)
    expect(sqls.some(s => /UPDATE orders SET payment_status = 'refunded'/.test(s))).toBe(false)
    expect(vi.mocked(autoTasks.completeAutoTask).mock.calls.some(c => c[0] === 'process_refund')).toBe(false)
  })

  it('swallows every rejecting side-effect on a cancelled+paid order (catch arrows)', async () => {
    const razorpay = await import('@/lib/razorpay')
    const email = await import('@/lib/email')
    const autoTasks = await import('@/lib/auto-tasks')
    const activity = await import('@/lib/activity')
    const delhivery = await import('@/lib/delhivery')

    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE_ORDER,
        status: 'confirmed',
        payment_status: 'paid',
        customer_email: 'c@x.com',
        customer_name: 'Cust',
        users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
      }) // currentOrder
      .mockResolvedValueOnce(null) // sale ledger check → no restore
      .mockResolvedValueOnce({ awb_number: 'AWB123' }) // notify() awb lookup

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(razorpay.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(razorpay.getRazorpayInstance).mockReturnValue({
      payments: { refund: vi.fn().mockResolvedValue({ id: 'rfnd_1' }) },
    } as any)

    // Make all the swallowed side-effects reject to execute their .catch arrows
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log fail'))
    vi.mocked(email.sendPaymentStatusUpdate).mockRejectedValue(new Error('mail fail'))
    vi.mocked(email.sendOrderStatusUpdate).mockRejectedValue(new Error('mail fail'))
    vi.mocked(autoTasks.completeAutoTask).mockRejectedValue(new Error('task fail'))
    vi.mocked(autoTasks.createAutoTask).mockRejectedValue(new Error('task fail'))
    vi.mocked(delhivery.cancelDelhiveryShipment).mockRejectedValue(new Error('delhivery fail'))

    const res = await PATCH(makeReq('PATCH', { status: 'cancelled' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()

    // Even though everything rejected, the response succeeded and delhivery cancel was attempted
    expect(vi.mocked(delhivery.cancelDelhiveryShipment)).toHaveBeenCalledWith('AWB123')
    expect(vi.mocked(email.sendOrderStatusUpdate)).toHaveBeenCalled()
  })

  it('does NOT create a refund task on cancel even when razorpay is enabled', async () => {
    const razorpay = await import('@/lib/razorpay')
    const autoTasks = await import('@/lib/auto-tasks')

    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE_ORDER,
        status: 'confirmed',
        payment_status: 'paid',
        customer_email: 'c@x.com',
        customer_name: 'Cust',
        users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
      }) // currentOrder
      .mockResolvedValueOnce(null) // sale ledger check → no restore

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(razorpay.isRazorpayEnabled).mockResolvedValue(true)

    const res = await PATCH(makeReq('PATCH', { status: 'cancelled' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()

    expect(
      vi.mocked(autoTasks.createAutoTask).mock.calls.some(c => (c[0] as any)?.sourceKind === 'process_refund')
    ).toBe(false)
  })

  it('restores stock on cancellation when a sale ledger row exists', async () => {
    const orderStock = await import('@/lib/order-stock')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE_ORDER,
        status: 'confirmed',
        payment_status: 'unpaid',
        users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
      }) // currentOrder
      .mockResolvedValueOnce({ '?column?': 1 }) // sale ledger row exists
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await PATCH(makeReq('PATCH', { status: 'cancelled' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()
    expect(vi.mocked(orderStock.restoreOrderStock)).toHaveBeenCalledWith('order-1')
  })

  it('completes process_confirmed and generates invoice for paid confirmed→processing', async () => {
    const invoice = await import('@/lib/invoice')
    const autoTasks = await import('@/lib/auto-tasks')
    const email = await import('@/lib/email')

    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE_ORDER,
        status: 'confirmed',
        payment_status: 'paid',
        users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
      }) // currentOrder
      .mockResolvedValueOnce(null) // preflight unitRow
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      {
        product_id: 'p1',
        variant_id: null,
        sub_variant_id: null,
        quantity: '1',
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

    const res = await PATCH(makeReq('PATCH', { status: 'processing' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()

    expect(vi.mocked(autoTasks.completeAutoTask).mock.calls.some(c => c[0] === 'process_confirmed')).toBe(true)
    // paid + confirmed→processing generates the invoice, then emails it
    expect(vi.mocked(invoice.generateOrderInvoice)).toHaveBeenCalledWith('order-1')
    expect(vi.mocked(email.sendOrderStatusUpdate)).toHaveBeenCalled()
  })

  it('swallows a failing invoice render on paid confirmed→processing', async () => {
    const invoice = await import('@/lib/invoice')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE_ORDER,
        status: 'confirmed',
        payment_status: 'paid',
        users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
      })
      .mockResolvedValueOnce(null) // preflight unitRow
    vi.mocked(db.queryMany).mockResolvedValueOnce([
      {
        product_id: 'p1',
        variant_id: null,
        sub_variant_id: null,
        quantity: '1',
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
    vi.mocked(invoice.generateOrderInvoice).mockRejectedValueOnce(new Error('pdf fail'))

    const res = await PATCH(makeReq('PATCH', { status: 'processing' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()
    expect(vi.mocked(invoice.generateOrderInvoice)).toHaveBeenCalled()
  })

  it('generates invoice when payment flips to paid on a confirmed order', async () => {
    const invoice = await import('@/lib/invoice')
    const email = await import('@/lib/email')
    const marketing = await import('@/lib/marketing')

    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'confirmed',
      payment_status: 'unpaid',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await PATCH(makeReq('PATCH', { payment_status: 'paid' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()

    expect(vi.mocked(invoice.generateOrderInvoice)).toHaveBeenCalledWith('order-1')
    expect(vi.mocked(email.sendPaymentStatusUpdate)).toHaveBeenCalled()
    expect(vi.mocked(marketing.attributeConversion)).toHaveBeenCalledWith('user-1', 'order-1')
  })

  it('completes confirm_cod_payment task when cod payment flips to paid', async () => {
    const autoTasks = await import('@/lib/auto-tasks')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'delivered',
      payment_status: 'cod',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await PATCH(makeReq('PATCH', { payment_status: 'paid' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()
    expect(vi.mocked(autoTasks.completeAutoTask).mock.calls.some(c => c[0] === 'confirm_cod_payment')).toBe(true)
  })

  it('creates a COD confirmation task when a cod order is delivered', async () => {
    const autoTasks = await import('@/lib/auto-tasks')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'out_for_delivery',
      payment_status: 'cod',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await PATCH(makeReq('PATCH', { status: 'delivered' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()
    expect(vi.mocked(autoTasks.completeAutoTask).mock.calls.some(c => c[0] === 'stuck_shipment')).toBe(true)
    expect(vi.mocked(autoTasks.completeAutoTask).mock.calls.some(c => c[0] === 'ndr_check')).toBe(true)
    expect(
      vi.mocked(autoTasks.createAutoTask).mock.calls.some(c => (c[0] as any)?.sourceKind === 'confirm_cod_payment')
    ).toBe(true)
  })

  it('does not email when the order has no user and no customer contact', async () => {
    const email = await import('@/lib/email')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    // pending→confirmed: no stock preflight, no user block, notify() has no contact
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'pending',
      user_id: null,
      customer_email: null,
      customer_name: null,
      users: null,
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await PATCH(makeReq('PATCH', { status: 'confirmed' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()
    expect(vi.mocked(email.sendOrderStatusUpdate)).not.toHaveBeenCalled()
  })

  it('swallows a rejecting completeAutoTask on shipped transition', async () => {
    const autoTasks = await import('@/lib/auto-tasks')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'processing',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(autoTasks.completeAutoTask).mockRejectedValue(new Error('task fail'))

    const res = await PATCH(makeReq('PATCH', { status: 'shipped' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()
    expect(vi.mocked(autoTasks.completeAutoTask).mock.calls.some(c => c[0] === 'stuck_processing')).toBe(true)
  })

  it('swallows rejecting side-effects on failed payment_status', async () => {
    const autoTasks = await import('@/lib/auto-tasks')
    const activity = await import('@/lib/activity')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      payment_status: 'pending',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(autoTasks.createAutoTask).mockRejectedValue(new Error('task fail'))
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log fail'))

    const res = await PATCH(makeReq('PATCH', { payment_status: 'failed' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()
    expect(
      vi.mocked(autoTasks.createAutoTask).mock.calls.some(c => (c[0] as any)?.sourceKind === 'contact_failed_payment')
    ).toBe(true)
  })

  it('swallows rejecting completeAutoTask + attributeConversion on refunded/paid', async () => {
    const autoTasks = await import('@/lib/auto-tasks')
    const marketing = await import('@/lib/marketing')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      payment_status: 'paid',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(autoTasks.completeAutoTask).mockRejectedValue(new Error('task fail'))
    vi.mocked(marketing.attributeConversion).mockRejectedValue(new Error('mkt fail'))

    // refunded triggers process_refund + chase_refund completions (both reject → catch arrows)
    const res = await PATCH(makeReq('PATCH', { payment_status: 'refunded' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()
    expect(vi.mocked(autoTasks.completeAutoTask).mock.calls.some(c => c[0] === 'chase_refund')).toBe(true)
  })

  it('swallows attributeConversion rejection when payment flips to paid', async () => {
    const marketing = await import('@/lib/marketing')
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...BASE_ORDER,
      status: 'confirmed',
      payment_status: 'unpaid',
      users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
    })
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(marketing.attributeConversion).mockRejectedValue(new Error('mkt fail'))

    const res = await PATCH(makeReq('PATCH', { payment_status: 'paid' }) as any, PARAMS)
    expect(res.status).toBe(200)
    await flush()
    expect(vi.mocked(marketing.attributeConversion)).toHaveBeenCalledWith('user-1', 'order-1')
  })

  it('swallows a rejecting notify() (outer catch) when awb lookup throws on cancel', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE_ORDER,
        status: 'confirmed',
        payment_status: 'unpaid',
        customer_email: 'c@x.com',
        customer_name: 'Cust',
        users: { email: 'a@b.com', first_name: 'A', last_name: 'B' },
      }) // currentOrder
      .mockResolvedValueOnce(null) // sale ledger check → no restore
      .mockRejectedValueOnce(new Error('awb boom')) // notify() awb lookup throws → notify() rejects
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await PATCH(makeReq('PATCH', { status: 'cancelled' }) as any, PARAMS)
    // outer notify().catch(() => {}) swallows the rejection; response still 200
    expect(res.status).toBe(200)
    await flush()
  })
})
