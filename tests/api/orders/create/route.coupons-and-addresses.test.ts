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

  it('applies flat coupon discount correctly', async () => {
    const cartItem = { ...CART_ITEM, quantity: '1' } // subtotal = 100

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER) // user
      .mockResolvedValueOnce(null) // min_order_amount
    vi.mocked(db.queryMany).mockResolvedValue([cartItem])

    // flat ₹25 off — validation resolves via order-commit helper
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({
      appliedDiscount: 25,
      ok: true,
    })

    let capturedDiscount = 0
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
          if (sql.includes('INSERT INTO orders')) {
            capturedDiscount = params[9]
            return { rows: [CREATED_ORDER], rowCount: 1 }
          }
          return { rows: [], rowCount: 0 }
        }),
      }
      return fn(client)
    })

    const req = makeRequest({ paymentMethod: 'cod', couponId: 'coupon-flat' })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    expect(res.status).not.toBe(400)
    expect(capturedDiscount).toBe(25)
  })

  it('skips coupon when per-user usage limit is reached', async () => {
    const cartItem = { ...CART_ITEM, quantity: '1' }

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER) // user
      .mockResolvedValueOnce(null) // min_order_amount
      .mockResolvedValueOnce({
        // coupon with per-user limit
        id: 'coupon-limited',
        discount_type: 'percentage',
        discount_value: 20,
        min_purchase_amount: null,
        max_discount_amount: null,
        usage_limit: null,
        usage_limit_per_user: 1,
        times_used: 5,
        valid_from: null,
        valid_until: null,
        is_active: true,
      })
      .mockResolvedValueOnce({ cnt: '1' }) // per-user usage = 1 (limit reached)
    vi.mocked(db.queryMany).mockResolvedValue([cartItem])

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValue({ rows: [CREATED_ORDER], rowCount: 1 }),
      }
      return fn(client)
    })

    const req = makeRequest({ paymentMethod: 'cod', couponId: 'coupon-limited' })
    const res = await POST(req as any)

    // Order should still be created (coupon simply not applied), not an error
    expect(res.status).toBe(200)
  })

  it('uses existing shipping address when found in DB', async () => {
    const existingAddr = { id: 'addr-existing', full_name: 'Test User', city: 'Mumbai', postal_code: '400001' }

    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // min_order_amount
    vi.mocked(db.queryMany).mockResolvedValue([CART_ITEM])

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [existingAddr], rowCount: 1 }) // existing address found
          .mockResolvedValueOnce({ rows: [existingAddr], rowCount: 1 }) // addr snapshot lookup
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // existingUnpaid
          .mockResolvedValue({ rows: [CREATED_ORDER], rowCount: 1 }),
      }
      return fn(client)
    })

    const req = makeRequest({
      paymentMethod: 'cod',
      shippingAddress: {
        fullName: 'Test User',
        addressLine1: '123 Main St',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India',
      },
    })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
  })

  it('inserts new shipping address when not found in DB', async () => {
    const newAddr = { id: 'addr-new', full_name: 'Test User', city: 'Delhi', postal_code: '110001' }

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // min_order_amount
    vi.mocked(db.queryMany).mockResolvedValue([CART_ITEM])

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // existing address NOT found
          .mockResolvedValueOnce({ rows: [newAddr], rowCount: 1 }) // INSERT address RETURNING
          .mockResolvedValueOnce({ rows: [newAddr], rowCount: 1 }) // addr snapshot lookup
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // existingUnpaid
          .mockResolvedValue({ rows: [CREATED_ORDER], rowCount: 1 }),
      }
      return fn(client)
    })

    const req = makeRequest({
      paymentMethod: 'cod',
      shippingAddress: {
        fullName: 'Test User',
        addressLine1: '456 New St',
        city: 'Delhi',
        state: 'Delhi',
        postalCode: '110001',
        country: 'India',
      },
    })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
  })

  it('triggers high-value order auto-task when total >= 50000', async () => {
    const { createAutoTask } = await import('@/lib/shared/auto-tasks')
    const highValueOrder = { ...CREATED_ORDER, total_amount: '50000', order_number: 'ORD-HV-001' }
    const highValueCartItem = { ...CART_ITEM, quantity: '500' } // 500 * 100 = 50000

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // min_order_amount
    vi.mocked(db.queryMany).mockResolvedValue([highValueCartItem])

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // existingUnpaid
          .mockResolvedValue({ rows: [highValueOrder], rowCount: 1 }),
      }
      return fn(client)
    })

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    // createAutoTask should have been called (fire-and-forget, so just check no crash)
    expect(vi.mocked(createAutoTask)).toHaveBeenCalled()
  })

  it('returns 500 on unexpected database error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER)
    vi.mocked(db.queryMany).mockRejectedValue(new Error('DB exploded'))

    const req = makeRequest({ paymentMethod: 'cod' })
    const res = await POST(req as any)

    expect(res.status).toBe(500)
  })
})
