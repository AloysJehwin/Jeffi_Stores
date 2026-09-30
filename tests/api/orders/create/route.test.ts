import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- mock all external deps before any imports ---
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/catalog/gst', () => ({
  isInterState: vi.fn().mockReturnValue(false),
  calculateGST: vi.fn().mockReturnValue({ taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 }),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/shared/ai-feedback', () => ({ recordImplicitSignalsForProducts: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/orders/order-commit', () => ({
  quoteShipping: vi.fn().mockResolvedValue({ shipping: 0, codFee: 0 }),
  validateCouponForUser: vi.fn(),
}))
vi.mock('@/lib/documents/invoice', () => ({ createDraftInvoice: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/catalog/business-discount', () => ({ getBusinessDiscountMap: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/shared/sms', () => ({ sendOrderConfirmedSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({
    razorpayEnabled: true,
    codEnabled: true,
    gstEnabled: false,
    inventoryValidationEnabled: true,
    smsEnabled: true,
    whatsappEnabled: true,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
    ondeviceSummaryMobileEnabled: false,
    ondeviceSummaryDesktopEnabled: false,
    ondeviceFinetuneMobileEnabled: false,
    ondeviceFinetuneDesktopEnabled: false,
  }),
  getBusinessValues: vi.fn().mockResolvedValue({
    codSurchargeFlat: 0,
    codSurchargePct: 0,
    shippingMinCharge: 0,
    shippingMaxCharge: 0,
    orderAutoCancelMinutes: 10,
    returnStandardCharge: 0,
    delhiveryOriginPincode: '110001',
    businessStateCode: '22',
    defaultProductWeightG: 500,
    defaultWeightG: 50,
    pickupLocation: '',
    sellerName: '',
    sellerAddress: '',
    sellerPhone: '',
  }),
}))
vi.mock('@/lib/shipping/delhivery', () => ({
  checkPincodeServiceability: vi.fn().mockResolvedValue({ serviceable: true, cod: true, prepaid: true }),
}))
vi.mock('@/lib/shipping/edd', () => ({
  computeEdd: vi.fn().mockReturnValue('2026-09-30'),
}))
vi.mock('@/lib/shared/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/shared/validate')>()
  return { ...actual }
})

import { POST } from '@/app/api/(public)/orders/create/route'
import * as db from '@/lib/shared/db'
import * as jwt from '@/lib/auth/jwt'
import * as orderCommit from '@/lib/orders/order-commit'

// ------------------------------------------------------------------ helpers

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/orders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const AUTH_USER = { userId: 'user-123', email: 'test@example.com', isBusiness: false }

const MOCK_USER = {
  id: 'user-123',
  email: 'test@example.com',
  phone: '9999999999',
  first_name: 'Test',
  last_name: 'User',
}

const CART_ITEM = {
  product_id: 'prod-1',
  variant_id: null,
  sub_variant_id: null,
  quantity: '2',
  buy_mode: 'unit',
  price_at_addition: '100',
  products: {
    id: 'prod-1',
    name: 'Widget',
    sku: 'WGT-001',
    base_price: '100',
    price_ex_gst: '90',
    gst_percentage: '18',
    hsn_code: '84733099',
    stock_status: 'in_stock',
    inventory_quantity: 10,
  },
  variant: null,
  sub_variant: null,
}

const CREATED_ORDER = {
  id: 'order-abc',
  order_number: 'ORD-123',
  total_amount: '200',
  status: 'pending',
  payment_status: 'unpaid',
}

// ------------------------------------------------------------------ shared setup

function setupHappyPath() {
  vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
  vi.mocked(db.queryOne)
    .mockResolvedValueOnce(MOCK_USER) // user lookup
    .mockResolvedValueOnce(null) // min_order_amount setting
  vi.mocked(db.queryMany).mockResolvedValue([CART_ITEM])

  // withTransaction calls the callback and returns CREATED_ORDER
  vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    }
    return fn(client)
  })
  // queryOne inside the transaction callback — return the created order
  vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER) // user (already above)

  return { authUser: AUTH_USER, user: MOCK_USER, cartItem: CART_ITEM }
}

// ------------------------------------------------------------------ tests

describe('POST /api/orders/create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 400 when cart is empty', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER)
    vi.mocked(db.queryMany).mockResolvedValue([])

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/cart is empty/i)
  })

  it('returns 400 when subtotal is below minimum order amount', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce({ value: '500' }) // min_order_amount = 500
    vi.mocked(db.queryMany).mockResolvedValue([CART_ITEM]) // subtotal = 200

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/minimum order/i)
  })

  it('returns 409 with existingOrderId when EXISTING_UNPAID_ORDER is thrown', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // min_order_amount
    vi.mocked(db.queryMany).mockResolvedValue([CART_ITEM])

    const existingOrderId = 'existing-order-uuid'
    const existingOrderNumber = 'ORD-EXISTING-001'

    vi.mocked(db.withTransaction).mockRejectedValue(
      Object.assign(new Error('EXISTING_UNPAID_ORDER'), {
        existingOrderId,
        existingOrderNumber,
      })
    )

    const req = makeRequest({ paymentMethod: 'razorpay' })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.existingOrderId).toBe(existingOrderId)
    expect(body.existingOrderNumber).toBe(existingOrderNumber)
    expect(body.error).toMatch(/unpaid order/i)
  })

  it('happy path: creates order and returns orderId for COD payment', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER) // user
      .mockResolvedValueOnce(null) // min_order_amount
    vi.mocked(db.queryMany).mockResolvedValue([CART_ITEM])

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // existingUnpaid check
          .mockResolvedValue({ rows: [CREATED_ORDER], rowCount: 1 }), // order insert
      }
      return fn(client)
    })

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.order).toBeDefined()
    expect(body.requiresPayment).toBe(false)
  })

  it('returns requiresPayment: true for razorpay payment method', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValue([CART_ITEM])

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValue({ rows: [CREATED_ORDER], rowCount: 1 }),
      }
      return fn(client)
    })

    const req = makeRequest({ paymentMethod: 'razorpay' })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.requiresPayment).toBe(true)
  })

  it('applies percentage coupon discount correctly', async () => {
    const cartItem = { ...CART_ITEM, quantity: '1' } // GST off ⇒ ex-GST price 90, qty 1 → subtotal = 90

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER) // user
      .mockResolvedValueOnce(null) // min_order_amount
    vi.mocked(db.queryMany).mockResolvedValue([cartItem])

    // Coupon validation now lives in validateCouponForUser (order-commit).
    // Mock returns a fixed applied discount of 10.
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({
      appliedDiscount: 10,
      ok: true,
    })

    let capturedDiscount = 0
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
          if (sql.includes('INSERT INTO orders')) {
            capturedDiscount = params[9] // discount_amount is index 9
            return { rows: [CREATED_ORDER], rowCount: 1 }
          }
          // existingUnpaid check and any other queries
          return { rows: [], rowCount: 0 }
        }),
      }
      return fn(client)
    })

    const req = makeRequest({ paymentMethod: 'cod', couponId: 'coupon-1' })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    expect(vi.mocked(orderCommit.validateCouponForUser)).toHaveBeenCalledWith(
      expect.objectContaining({ couponId: 'coupon-1', userId: 'user-123', subtotal: 90 })
    )
    // fixed mock applied discount = 10
    expect(capturedDiscount).toBe(10)
  })

  it('returns 404 when user is not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue(null) // user not found — mockResolvedValue (not Once) to avoid queue leakage

    const req = makeRequest({ paymentMethod: 'manual' })
    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatch(/user not found/i)
  })
})
