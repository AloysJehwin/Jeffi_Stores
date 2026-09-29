import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn().mockReturnValue(false),
  calculateGST: vi.fn().mockReturnValue({ taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 }),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/auto-tasks', () => ({ createAutoTask: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ai-feedback', () => ({ recordImplicitSignalsForProducts: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/order-commit', () => ({
  quoteShipping: vi.fn().mockResolvedValue({ shipping: 0, codFee: 0 }),
  validateCouponForUser: vi.fn().mockResolvedValue({ appliedDiscount: 0, ok: false, reason: 'not_found' }),
}))
vi.mock('@/lib/invoice', () => ({ createDraftInvoice: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/business-discount', () => ({ getBusinessDiscountMap: vi.fn().mockResolvedValue({}) }))
// GST enabled ⇒ line price follows the price_at_addition/variant/sub_variant/base_price
// precedence these tests assert (the GST-off path charges the ex-GST column instead).
vi.mock('@/lib/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({
    razorpayEnabled: false,
    codEnabled: true,
    gstEnabled: true,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
  }),
  getBusinessValues: vi.fn().mockResolvedValue({ businessStateCode: '22' }),
}))
vi.mock('@/lib/edd', () => ({ computeEdd: vi.fn().mockReturnValue('2026-09-30') }))
vi.mock('@/lib/sms', () => ({ sendOrderConfirmedSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/delhivery', () => ({
  checkPincodeServiceability: vi.fn().mockResolvedValue({ serviceable: true, cod: true, prepaid: true }),
}))
vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { POST } from '@/app/api/orders/create/route'
import * as db from '@/lib/db'
import * as jwt from '@/lib/jwt'
import * as bizDiscount from '@/lib/business-discount'
import * as gstLib from '@/lib/gst'
import * as orderCommit from '@/lib/order-commit'
import { getFeatureFlags } from '@/lib/site-controls'

const enableRazorpay = () =>
  vi.mocked(getFeatureFlags).mockResolvedValueOnce({
    razorpayEnabled: true,
    codEnabled: true,
    gstEnabled: true,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
  } as any)

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/orders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const AUTH_USER = { userId: 'user-99', email: 'branchuser@example.com', isBusiness: false }

const MOCK_USER = {
  id: 'user-99',
  email: 'branchuser@example.com',
  phone: '8888888888',
  first_name: 'Branch',
  last_name: 'Tester',
}

function baseCartItem(overrides: any = {}) {
  return {
    product_id: 'prod-b1',
    variant_id: null,
    sub_variant_id: null,
    quantity: '2',
    buy_mode: 'unit',
    buy_unit: null,
    price_at_addition: '0',
    products: {
      id: 'prod-b1',
      name: 'BranchWidget',
      sku: 'B-001',
      base_price: '100',
      price_ex_gst: '90',
      gst_percentage: '18',
      hsn_code: '84',
      stock_status: 'in_stock',
      inventory_quantity: 50,
      is_active: true,
      is_cod_allowed: true,
      category_id: 'cat-1',
      discount_pct: 0,
      extra_delivery_days: 0,
      handling_days: 2,
      mrp: 120,
    },
    variant: null,
    sub_variant: null,
    ...overrides,
  }
}

const CREATED_ORDER = {
  id: 'order-b1',
  order_number: 'ORD-B-001',
  total_amount: '200',
  status: 'pending',
  payment_status: 'unpaid',
}

function txClientReturning(order: any = CREATED_ORDER, extraQueries: any[] = []) {
  const client = { query: vi.fn() }
  // Default: address not found (empty), snapshot lookup empty, existingUnpaid empty, order insert
  let call = 0
  client.query.mockImplementation(async (sql: string, _params: any[]) => {
    if (extraQueries[call]) {
      const val = extraQueries[call]
      call++
      return val
    }
    call++
    if (sql.includes('INSERT INTO orders')) {
      return { rows: [order], rowCount: 1 }
    }
    if (sql.includes('INSERT INTO addresses')) {
      return { rows: [{ id: 'addr-new', full_name: 'X' }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  })
  return client
}

describe('POST /api/orders/create — additional branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(bizDiscount.getBusinessDiscountMap).mockResolvedValue({})
    vi.mocked(gstLib.isInterState).mockReturnValue(false)
    vi.mocked(orderCommit.quoteShipping).mockResolvedValue({ shipping: 0, codFee: 0 })
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ appliedDiscount: 0, ok: false, reason: 'not_found' } as any)
  })

  it('returns 422 when cart contains inactive product', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER)
    const inactive = baseCartItem({ products: { ...baseCartItem().products, is_active: false } })
    vi.mocked(db.queryMany).mockResolvedValue([inactive])

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toMatch(/no longer available/i)
    expect(body.inactiveProductIds).toEqual(['prod-b1'])
  })

  it('returns 422 for cod when a product does not allow COD', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER)
    const codBlocked = baseCartItem({ products: { ...baseCartItem().products, is_cod_allowed: false } })
    vi.mocked(db.queryMany).mockResolvedValue([codBlocked])

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toMatch(/COD is not available/i)
    expect(body.codBlockedProductIds).toEqual(['prod-b1'])
  })

  it('allows COD when all items allow it (payment_mode = cod, status cod_pending)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // min order
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])

    let capturedPaymentMode: string | null = null
    let capturedPaymentStatus: string | null = null
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO orders')) {
          capturedPaymentStatus = params[6]
          capturedPaymentMode = params[7]
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    expect(capturedPaymentMode).toBe('cod')
    expect(capturedPaymentStatus).toBe('cod_pending')
  })

  it('applies business discount when category is in discount map', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])
    vi.mocked(bizDiscount.getBusinessDiscountMap).mockResolvedValue({ 'cat-1': 10 })

    let capturedBizDiscount = 0
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO orders')) {
          capturedBizDiscount = Number(params[10])
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    // 200 subtotal * 10% = 20
    expect(capturedBizDiscount).toBe(20)
  })

  it('does not apply coupon when validity window has not started', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])

    // Coupon validation is delegated to validateCouponForUser; a not-yet-valid
    // coupon returns ok:false so no discount is applied.
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({
      appliedDiscount: 0,
      ok: false,
      reason: 'not_yet_valid',
    } as any)

    let discountApplied = -1
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO orders')) {
          discountApplied = Number(params[9])
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    const req = makeRequest({ paymentMethod: 'cod', couponId: 'coupon-future' })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(discountApplied).toBe(0)
  })

  it('does not apply coupon when min_purchase_amount not met', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()]) // subtotal 200

    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({
      appliedDiscount: 0,
      ok: false,
      reason: 'below_min_purchase',
    } as any)

    let captured = -1
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO orders')) {
          captured = Number(params[9])
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })

    const res = await POST(makeRequest({ paymentMethod: 'cod', couponId: 'coupon-min' }) as any)
    expect(res.status).toBe(200)
    expect(captured).toBe(0)
  })

  it('caps percentage coupon discount at max_discount_amount', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()]) // subtotal 200

    // 50% of 200 = 100, capped at 30 by max_discount_amount — validateCouponForUser
    // performs the capping and returns the final appliedDiscount.
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({
      appliedDiscount: 30,
      ok: true,
    } as any)

    let captured = -1
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO orders')) {
          captured = Number(params[9])
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })

    const res = await POST(makeRequest({ paymentMethod: 'cod', couponId: 'coupon-capped' }) as any)
    expect(res.status).toBe(200)
    expect(captured).toBe(30)
  })

  it('inactive coupon leaves discount at 0', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])

    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({
      appliedDiscount: 0,
      ok: false,
      reason: 'inactive',
    } as any)

    let captured = -1
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO orders')) {
          captured = Number(params[9])
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    const res = await POST(makeRequest({ paymentMethod: 'cod', couponId: 'c-inactive' }) as any)
    expect(res.status).toBe(200)
    expect(captured).toBe(0)
  })

  it('coupon not found — order proceeds with no discount', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([baseCartItem()])

    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({
      appliedDiscount: 0,
      ok: false,
      reason: 'not_found',
    } as any)

    let captured = -1
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn() }
      client.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO orders')) {
          captured = Number(params[9])
          return { rows: [CREATED_ORDER], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })
      return fn(client)
    })
    const res = await POST(makeRequest({ paymentMethod: 'cod', couponId: 'no-coupon' }) as any)
    expect(res.status).toBe(200)
    expect(captured).toBe(0)
  })
})
