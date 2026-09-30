import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn().mockReturnValue(false),
  calculateGST: vi.fn().mockReturnValue({ totalTax: 45, taxableAmount: 455, cgst: 22.5, sgst: 22.5, igst: 0 }),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/ai-feedback', () => ({
  recordImplicitSignal: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/order-commit', () => ({
  resolveBuyNowItem: vi.fn(),
  quoteShipping: vi.fn().mockResolvedValue({ shipping: 0, codFee: 0 }),
  validateCouponForUser: vi.fn().mockResolvedValue({ ok: false }),
  loadAddress: vi.fn(),
}))
vi.mock('@/lib/business-discount', () => ({
  getBusinessDiscountMap: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})
vi.mock('@/lib/checkout-intent', () => ({
  verifyIntent: vi.fn(),
}))
vi.mock('@/lib/edd', () => ({
  computeEdd: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/site-controls', () => ({
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
    codSurchargeFlat: 40,
    codSurchargePct: 2,
    shippingMinCharge: 0,
    shippingMaxCharge: 200,
    orderAutoCancelMinutes: 10,
    returnStandardCharge: 100,
    delhiveryOriginPincode: '492001',
    businessStateCode: '22',
    defaultProductWeightG: 500,
    defaultWeightG: 50,
    pickupLocation: 'Jeffi Stores',
    sellerName: 'Jeffi Stores',
    sellerAddress: 'Raipur',
    sellerPhone: '07713585374',
  }),
}))
vi.mock('@/lib/delhivery', () => ({
  checkPincodeServiceability: vi.fn().mockResolvedValue({ serviceable: true, cod: true, prepaid: true }),
}))

import { POST } from '@/app/api/orders/create-direct/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as orderCommit from '@/lib/order-commit'
import * as checkoutIntent from '@/lib/checkout-intent'

const USER = { userId: 'user-1' }

const MOCK_USER = {
  id: 'user-1',
  email: 'test@example.com',
  phone: '9999999999',
  first_name: 'Test',
  last_name: 'User',
}

const MOCK_PRODUCT = {
  id: 'prod-1',
  name: 'Test Product',
  sku: 'SKU001',
  base_price: '500',
  gst_percentage: '18',
  hsn_code: '12345',
}

const VALID_ITEM = {
  productId: '550e8400-e29b-41d4-a716-446655440001',
  qty: 2,
}

const VALID_BODY = {
  paymentMethod: 'cod',
  item: VALID_ITEM,
}

function makeRequest(body: unknown = VALID_BODY) {
  return new Request('http://localhost/api/orders/create-direct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/orders/create-direct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'order-created', order_number: 'ORD-001', total_amount: '1000', status: 'pending' }],
        }),
      }
      return fn(client)
    })
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns 404 when user not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null) // user not found
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(404)
  })

  it('returns 409 when user has existing unpaid order', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER) // user
      .mockResolvedValueOnce({ id: 'existing-order', order_number: 'ORD-EXISTING' }) // existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.existingOrderId).toBe('existing-order')
  })

  it('returns 400 when resolveBuyNowItem fails', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({ ok: false, error: 'Product not found' } as any)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Product not found')
  })

  it('returns 404 when product not found in DB', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null) // product not found
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(404)
  })

  it('creates order successfully for manual payment', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT) // product
      .mockResolvedValueOnce(null) // min order setting
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Order created successfully')
    expect(body.requiresPayment).toBe(false)
  })

  it('creates order for razorpay payment', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ ...VALID_BODY, paymentMethod: 'razorpay' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.requiresPayment).toBe(true)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(500)
  })

  it('returns 400 when subtotal is below minimum order amount', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 50 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce({ value: '1000' }) // min_order_amount = 1000, subtotal = 50
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/minimum order/i)
  })

  it('applies coupon discount when validateCouponForUser returns ok:true', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null) // no min order setting
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ ok: true, appliedDiscount: 50 } as any)

    const res = await POST(makeRequest({ ...VALID_BODY, couponId: 'coupon-abc' }) as any)
    expect(res.status).toBe(200)
    expect(vi.mocked(orderCommit.validateCouponForUser)).toHaveBeenCalledWith(
      expect.objectContaining({ couponId: 'coupon-abc' })
    )
  })

  it('uses existing shipping address when found in DB', async () => {
    const existingAddr = { id: 'addr-1', full_name: 'Test', city: 'Mumbai', postal_code: '400001' }

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null) // no min order setting

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [existingAddr], rowCount: 1 }) // existing address found
          .mockResolvedValueOnce({ rows: [existingAddr], rowCount: 1 }) // addr snapshot
          .mockResolvedValue({
            rows: [{ id: 'order-created', order_number: 'ORD-001', total_amount: '1000', status: 'pending' }],
            rowCount: 1,
          }),
      }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        shippingAddress: {
          fullName: 'Test User',
          addressLine1: '123 Main St',
          city: 'Mumbai',
          state: 'Maharashtra',
          postalCode: '400001',
        },
      }) as any
    )
    expect(res.status).toBe(200)
  })

  it('inserts new shipping address when not found in DB', async () => {
    const newAddr = { id: 'addr-new', full_name: 'Test', city: 'Delhi', postal_code: '110001' }

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null) // no min order setting

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // address not found
          .mockResolvedValueOnce({ rows: [newAddr], rowCount: 1 }) // INSERT address
          .mockResolvedValueOnce({ rows: [newAddr], rowCount: 1 }) // addr snapshot
          .mockResolvedValue({
            rows: [{ id: 'order-created', order_number: 'ORD-001', total_amount: '1000', status: 'pending' }],
            rowCount: 1,
          }),
      }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        shippingAddress: {
          fullName: 'Test User',
          addressLine1: '456 New St',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
        },
      }) as any
    )
    expect(res.status).toBe(200)
  })

  it('resolves variant when variantId is provided', async () => {
    const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440099'
    const MOCK_VARIANT = { id: VARIANT_ID, variant_name: 'Large', sku: 'SKU001-L', price: '600' }

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: VARIANT_ID, subVariantId: null, qty: 1, price: 600 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT) // product
      .mockResolvedValueOnce(null) // min_order_amount
      .mockResolvedValueOnce(MOCK_VARIANT) // variant lookup

    const res = await POST(
      makeRequest({
        paymentMethod: 'cod',
        item: { productId: '550e8400-e29b-41d4-a716-446655440001', variantId: VARIANT_ID, qty: 1 },
      }) as any
    )
    expect(res.status).toBe(200)
  })

  // ── intent path ──────────────────────────────────────────────────────────

  it('returns 400 when intent token is invalid', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER) // user lookup
      .mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(checkoutIntent.verifyIntent).mockResolvedValue(null)

    const res = await POST(makeRequest({ paymentMethod: 'cod', intent: 'bad-token' }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid or expired checkout intent/)
  })

  it('returns 400 when intent mode is cart', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(checkoutIntent.verifyIntent).mockResolvedValue({
      mode: 'cart',
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      qty: 1,
      buyMode: null,
      buyUnit: null,
    } as any)

    const res = await POST(makeRequest({ paymentMethod: 'cod', intent: 'cart-token' }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cart order route/)
  })

  it('resolves item from valid buy_now intent', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(checkoutIntent.verifyIntent).mockResolvedValue({
      mode: 'buy_now',
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      qty: 2,
      buyMode: 'unit',
      buyUnit: null,
    } as any)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT) // product
      .mockResolvedValueOnce(null) // min_order_amount

    const res = await POST(makeRequest({ paymentMethod: 'cod', intent: 'valid-intent' }) as any)
    expect(res.status).toBe(200)
    expect(vi.mocked(checkoutIntent.verifyIntent)).toHaveBeenCalledWith('valid-intent')
  })

  it('returns 400 when no item and no intent provided', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/i)
  })

  // ── COD path ──────────────────────────────────────────────────────────────

  it('returns 422 when COD not available for product', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_PRODUCT,
      id: 'prod-1',
      is_cod_allowed: false,
    })

    const res = await POST(makeRequest({ ...VALID_BODY, paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/COD is not available/)
    expect(body.codBlockedProductIds).toContain('prod-1')
  })

  it('creates COD order successfully', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_PRODUCT, is_cod_allowed: true })
      .mockResolvedValueOnce(null) // min_order_amount

    const res = await POST(makeRequest({ ...VALID_BODY, paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).requiresPayment).toBe(false)
  })

  // ── business discount path ────────────────────────────────────────────────

  it('applies business discount when category discount exists', async () => {
    vi.mocked(db.queryOne).mockReset()
    const { getBusinessDiscountMap } = await import('@/lib/business-discount')
    vi.mocked(getBusinessDiscountMap).mockResolvedValue({ 'cat-1': 10 } as any)

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_PRODUCT, id: 'prod-1', category_id: 'cat-1' })
      .mockResolvedValueOnce(null) // min_order_amount

    const res = await POST(makeRequest({ ...VALID_BODY, paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).message).toBe('Order created successfully')
  })
})

// ── targeted fallback branch coverage ────────────────────────────────────────
describe('POST /api/orders/create-direct — targeted fallback branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'order-ok', order_number: 'ORD-T', total_amount: '500', status: 'pending' }],
        }),
      }
      return fn(client)
    })
  })

  // Line 78: intentData.buyMode is non-null (covers ?? undefined right-hand side)
  it('passes buyMode from intent when it is non-null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(checkoutIntent.verifyIntent).mockResolvedValue({
      mode: 'buy_now',
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      qty: 1,
      buyMode: 'box', // non-null — covers the ?? undefined right side
      buyUnit: 'dozen',
    } as any)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ paymentMethod: 'cod', intent: 'tok' }) as any)
    expect(res.status).toBe(200)
    expect(vi.mocked(orderCommit.resolveBuyNowItem)).toHaveBeenCalledWith(
      expect.objectContaining({ buyMode: 'box', buyUnit: 'dozen' })
    )
  })

  // Line 147: coupon present but validateCouponForUser returns ok=false — appliedDiscount stays 0
  it('skips discount when coupon validation returns ok=false', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ ok: false } as any)

    const res = await POST(makeRequest({ ...VALID_BODY, couponId: 'bad-coupon' }) as any)
    expect(res.status).toBe(200)
  })

  // Lines 153-154: category_id present but pct=0 — businessDiscountAmount stays 0
  it('skips business discount when category pct is 0', async () => {
    const { getBusinessDiscountMap } = await import('@/lib/business-discount')
    vi.mocked(getBusinessDiscountMap).mockResolvedValue({ 'cat-1': 0 } as any)

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_PRODUCT, category_id: 'cat-1' })
      .mockResolvedValueOnce(null)

    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(200)
  })

  // Line 174: shippingAddress has postal_code (snake_case) not postalCode
  it('reads destinationPin from postal_code fallback on shippingAddress', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.quoteShipping).mockResolvedValue({ shipping: 40, codFee: 0 })

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        // postal_code snake_case — not postalCode camelCase
        shippingAddress: { postal_code: '600001', state: 'TN' },
      }) as any
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(orderCommit.quoteShipping)).toHaveBeenCalledWith(
      expect.objectContaining({ destinationPin: '600001' })
    )
  })

  // Lines 183-185: isGSTEnabled=true, isIGST=true path (inter-state order)
  it('calculates IGST for inter-state order when GST enabled', async () => {
    const { isInterState, calculateGST } = await import('@/lib/gst')
    vi.mocked(isInterState).mockReturnValue(true)
    vi.mocked(calculateGST).mockReturnValue({
      totalTax: 90,
      taxableAmount: 500,
      cgst: 0,
      sgst: 0,
      igst: 90,
    } as any)

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        shippingAddress: { postalCode: '110001', state: 'Delhi' },
      }) as any
    )
    expect(res.status).toBe(200)
  })

  // Lines 213-214: shippingAddress present with addressLine2 and landmark
  it('stores landmark and addressLine2 when provided', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)

    let capturedParams: any[] = []
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn(async (sql: string, params?: any[]) => {
          if (/SELECT \* FROM addresses/i.test(sql)) return { rows: [], rowCount: 0 }
          if (/INSERT INTO addresses/i.test(sql)) {
            capturedParams = params || []
            return { rows: [{ id: 'addr-lm' }], rowCount: 1 }
          }
          return {
            rows: [{ id: 'order-lm', order_number: 'ORD-LM', total_amount: '500', status: 'pending' }],
            rowCount: 1,
          }
        }),
      }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        shippingAddress: {
          fullName: 'Test',
          addressLine1: '1 Main',
          addressLine2: 'Apt 2',
          landmark: 'Near Park',
          city: 'Pune',
          state: 'Maharashtra',
          postalCode: '411001',
          country: 'India',
        },
      }) as any
    )
    expect(res.status).toBe(200)
    // addressLine2 and landmark should be passed to INSERT
    expect(capturedParams).toContain('Apt 2')
    expect(capturedParams).toContain('Near Park')
  })

  // Lines 263-266: isGSTEnabled branches inside withTransaction for order INSERT
  it('sets non-razorpay order status to confirmed and sends emails', async () => {
    const { sendOrderConfirmationEmail, sendNewOrderNotification } = await import('@/lib/email')

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)

    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await POST(makeRequest({ ...VALID_BODY, paymentMethod: 'cod' }) as any)
    expect(res.status).toBe(200)
    expect(vi.mocked(db.query)).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE orders SET status = 'confirmed'/),
      expect.any(Array)
    )
    expect(vi.mocked(sendOrderConfirmationEmail)).toHaveBeenCalled()
    expect(vi.mocked(sendNewOrderNotification)).toHaveBeenCalled()
  })
})
describe('POST /api/orders/create-direct — additional branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'order-created', order_number: 'ORD-001', total_amount: '1000', status: 'pending' }],
        }),
      }
      return fn(client)
    })
  })

  it('returns 400 when body fails schema validation', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER)
    // paymentMethod is invalid enum value
    const res = await POST(makeRequest({ paymentMethod: 'bitcoin', item: VALID_ITEM }) as any)
    expect(res.status).toBe(400)
  })

  it('uses client-supplied shippingAmount when live quote is 0 and client amount present', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null) // min_order_amount
    // quoteShipping returns 0, clientShipping is 50
    vi.mocked(orderCommit.quoteShipping).mockResolvedValue({ shipping: 0, codFee: 0 })

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        shippingAmount: 50,
        shippingAddress: { postalCode: '400001', state: 'MH' },
      }) as any
    )
    expect(res.status).toBe(200)
  })

  it('uses live quote when quoteShipping returns non-zero', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.quoteShipping).mockResolvedValue({ shipping: 80, codFee: 0 })

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        shippingAmount: 50,
        shippingAddress: { postalCode: '400001', state: 'MH' },
      }) as any
    )
    expect(res.status).toBe(200)
  })

  it('handles address insert returning no rows gracefully', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // address not found
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT address returns no rows
          .mockResolvedValue({
            rows: [{ id: 'order-xyz', order_number: 'ORD-999', total_amount: '500', status: 'pending' }],
            rowCount: 1,
          }),
      }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        shippingAddress: {
          fullName: 'Test',
          addressLine1: '123 St',
          city: 'Chennai',
          state: 'Tamil Nadu',
          postalCode: '600001',
        },
      }) as any
    )
    expect(res.status).toBe(200)
  })

  it('builds full name from user first+last when shippingAddress.fullName missing', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_PRODUCT).mockResolvedValueOnce(null)

    let capturedPhone: string | undefined
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn(async (sql: string, params?: any[]) => {
          if (/SELECT \* FROM addresses/i.test(sql)) return { rows: [], rowCount: 0 }
          if (/INSERT INTO addresses/i.test(sql)) {
            capturedPhone = params?.[3]
            return { rows: [{ id: 'addr-new' }], rowCount: 1 }
          }
          return {
            rows: [{ id: 'order-new', order_number: 'ORD-X', total_amount: '500', status: 'pending' }],
            rowCount: 1,
          }
        }),
      }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        shippingAddress: {
          // no fullName — should fall back to user's first+last name
          addressLine1: '1 Test St',
          city: 'Hyderabad',
          state: 'Telangana',
          postalCode: '500001',
        },
      }) as any
    )
    expect(res.status).toBe(200)
    // phone falls back to user.phone
    expect(capturedPhone).toBe(MOCK_USER.phone)
  })

  it('applies product discount_pct when non-zero', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 450 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_PRODUCT, discount_pct: 10, mrp: '500' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'order-created', order_number: 'ORD-001', total_amount: '900', status: 'pending' }],
        }),
      }
      return fn(client)
    })
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(200)
  })

  it('uses variant mrp when variant exists and has mrp', async () => {
    const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440099'
    const MOCK_VARIANT = { id: VARIANT_ID, variant_name: 'Large', sku: 'SKU-L', mrp: '650' }

    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: VARIANT_ID, subVariantId: null, qty: 1, price: 600 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(MOCK_VARIANT)
    const res = await POST(
      makeRequest({
        paymentMethod: 'cod',
        item: { productId: '550e8400-e29b-41d4-a716-446655440001', variantId: VARIANT_ID, qty: 1 },
      }) as any
    )
    expect(res.status).toBe(200)
  })
})
