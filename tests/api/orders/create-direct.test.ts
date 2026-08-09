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
  quoteShipping: vi.fn().mockResolvedValue(0),
  validateCouponForUser: vi.fn().mockResolvedValue({ ok: false }),
  loadAddress: vi.fn(),
}))
vi.mock('@/lib/business-discount', () => ({
  getBusinessDiscountMap: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})
vi.mock('@/lib/checkout-intent', () => ({
  verifyIntent: vi.fn(),
}))
vi.mock('@/lib/edd', () => ({
  computeEdd: vi.fn().mockReturnValue(null),
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
  paymentMethod: 'manual',
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
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({ ok: true, item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 } } as any)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.existingOrderId).toBe('existing-order')
  })

  it('returns 400 when resolveBuyNowItem fails', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({ ok: false, error: 'Product not found' } as any)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Product not found')
  })

  it('returns 404 when product not found in DB', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // no existing unpaid
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
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // no existing unpaid
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
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT)
      .mockResolvedValueOnce(null)
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
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 50 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT)
      .mockResolvedValueOnce({ value: '1000' }) // min_order_amount = 1000, subtotal = 50
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/minimum order/i)
  })

  it('applies coupon discount when validateCouponForUser returns ok:true', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT)
      .mockResolvedValueOnce(null) // no min order setting
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
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT)
      .mockResolvedValueOnce(null) // no min order setting

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [existingAddr], rowCount: 1 }) // existing address found
          .mockResolvedValueOnce({ rows: [existingAddr], rowCount: 1 }) // addr snapshot
          .mockResolvedValue({ rows: [{ id: 'order-created', order_number: 'ORD-001', total_amount: '1000', status: 'pending' }], rowCount: 1 }),
      }
      return fn(client)
    })

    const res = await POST(makeRequest({
      ...VALID_BODY,
      shippingAddress: {
        fullName: 'Test User',
        addressLine1: '123 Main St',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
      },
    }) as any)
    expect(res.status).toBe(200)
  })

  it('inserts new shipping address when not found in DB', async () => {
    const newAddr = { id: 'addr-new', full_name: 'Test', city: 'Delhi', postal_code: '110001' }

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT)
      .mockResolvedValueOnce(null) // no min order setting

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })        // address not found
          .mockResolvedValueOnce({ rows: [newAddr], rowCount: 1 }) // INSERT address
          .mockResolvedValueOnce({ rows: [newAddr], rowCount: 1 }) // addr snapshot
          .mockResolvedValue({ rows: [{ id: 'order-created', order_number: 'ORD-001', total_amount: '1000', status: 'pending' }], rowCount: 1 }),
      }
      return fn(client)
    })

    const res = await POST(makeRequest({
      ...VALID_BODY,
      shippingAddress: {
        fullName: 'Test User',
        addressLine1: '456 New St',
        city: 'Delhi',
        state: 'Delhi',
        postalCode: '110001',
      },
    }) as any)
    expect(res.status).toBe(200)
  })

  it('resolves variant when variantId is provided', async () => {
    const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440099'
    const MOCK_VARIANT = { id: VARIANT_ID, variant_name: 'Large', sku: 'SKU001-L', price: '600' }

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null) // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: VARIANT_ID, subVariantId: null, qty: 1, price: 600 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT)         // product
      .mockResolvedValueOnce(null)                 // min_order_amount
      .mockResolvedValueOnce(MOCK_VARIANT)         // variant lookup

    const res = await POST(makeRequest({
      paymentMethod: 'manual',
      item: { productId: '550e8400-e29b-41d4-a716-446655440001', variantId: VARIANT_ID, qty: 1 },
    }) as any)
    expect(res.status).toBe(200)
  })

  // ── intent path ──────────────────────────────────────────────────────────

  it('returns 400 when intent token is invalid', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)   // user lookup
      .mockResolvedValueOnce(null)         // no existing unpaid
    vi.mocked(checkoutIntent.verifyIntent).mockResolvedValue(null)

    const res = await POST(makeRequest({ paymentMethod: 'manual', intent: 'bad-token' }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid or expired checkout intent/)
  })

  it('returns 400 when intent mode is cart', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)
    vi.mocked(checkoutIntent.verifyIntent).mockResolvedValue({
      mode: 'cart', productId: 'prod-1', variantId: null, subVariantId: null,
      qty: 1, buyMode: null, buyUnit: null,
    } as any)

    const res = await POST(makeRequest({ paymentMethod: 'manual', intent: 'cart-token' }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cart order route/)
  })

  it('resolves item from valid buy_now intent', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)        // no existing unpaid
    vi.mocked(checkoutIntent.verifyIntent).mockResolvedValue({
      mode: 'buy_now', productId: 'prod-1', variantId: null, subVariantId: null,
      qty: 2, buyMode: 'unit', buyUnit: null,
    } as any)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 2, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_PRODUCT)  // product
      .mockResolvedValueOnce(null)           // min_order_amount

    const res = await POST(makeRequest({ paymentMethod: 'manual', intent: 'valid-intent' }) as any)
    expect(res.status).toBe(200)
    expect(vi.mocked(checkoutIntent.verifyIntent)).toHaveBeenCalledWith('valid-intent')
  })

  it('returns 400 when no item and no intent provided', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ paymentMethod: 'manual' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/i)
  })

  // ── COD path ──────────────────────────────────────────────────────────────

  it('returns 422 when COD not available for product', async () => {
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)  // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_PRODUCT, id: 'prod-1', is_cod_allowed: false,
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
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)  // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_PRODUCT, is_cod_allowed: true })
      .mockResolvedValueOnce(null)  // min_order_amount

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
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(null)   // no existing unpaid
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_PRODUCT, id: 'prod-1', category_id: 'cat-1' })
      .mockResolvedValueOnce(null)  // min_order_amount

    const res = await POST(makeRequest({ ...VALID_BODY, paymentMethod: 'manual' }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).message).toBe('Order created successfully')
  })
})
