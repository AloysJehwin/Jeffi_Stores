import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that transitively use them
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn().mockReturnValue(false),
  calculateGST: vi.fn().mockImplementation((price: number, rate: number, isIGST: boolean) => {
    if (rate <= 0) return { taxableAmount: price, cgst: 0, sgst: 0, igst: 0, totalTax: 0 }
    const taxable = Math.round((price / (1 + rate / 100)) * 100) / 100
    const totalTax = Math.round((price - taxable) * 100) / 100
    if (isIGST) return { taxableAmount: taxable, cgst: 0, sgst: 0, igst: totalTax, totalTax }
    const half = Math.round((totalTax / 2) * 100) / 100
    return { taxableAmount: taxable, cgst: half, sgst: Math.round((totalTax - half) * 100) / 100, igst: 0, totalTax }
  }),
}))

vi.mock('@/lib/invoice', () => ({
  createDraftInvoice: vi.fn(),
}))

import {
  loadActiveCart,
  cartLineUnitPrice,
  cartItemsForHash,
  cartSubtotal,
  cartTaxAmount,
  resolveBuyNowItem,
  validateCouponForUser,
  loadAddress,
  getMinOrderAmount,
  quoteShipping,
  findExistingUnpaidRazorpayOrder,
  commitOrder,
  type CartLine,
} from '@/lib/order-commit'
import { queryMany, queryOne, withTransaction } from '@/lib/db'

const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockWithTransaction = vi.mocked(withTransaction)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    product_id: 'prod-1',
    variant_id: null,
    sub_variant_id: null,
    quantity: 2,
    price_at_addition: 100,
    buy_mode: 'unit',
    buy_unit: null,
    products: {
      id: 'prod-1',
      name: 'Widget',
      sku: 'WID-001',
      base_price: 100,
      price_ex_gst: null,
      gst_percentage: '18',
      hsn_code: '8501',
    },
    variant: null,
    sub_variant: null,
    ...overrides,
  }
}

function makeAddress(overrides: Record<string, any> = {}) {
  return {
    id: 'addr-1',
    user_id: 'user-1',
    full_name: 'Test User',
    phone: '9999999999',
    address_line1: '123 Main St',
    address_line2: null,
    landmark: null,
    city: 'Raipur',
    state: 'Chhattisgarh',
    postal_code: '492001',
    country: 'India',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// loadActiveCart
// ---------------------------------------------------------------------------

describe('loadActiveCart', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls queryMany with the user id and returns rows', async () => {
    const lines: CartLine[] = [makeCartLine()]
    mockQueryMany.mockResolvedValue(lines)
    const result = await loadActiveCart('user-1')
    expect(mockQueryMany).toHaveBeenCalledOnce()
    expect(mockQueryMany.mock.calls[0][1]).toEqual(['user-1'])
    expect(result).toBe(lines)
  })

  it('returns empty array when cart is empty', async () => {
    mockQueryMany.mockResolvedValue([])
    const result = await loadActiveCart('user-1')
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// cartLineUnitPrice
// ---------------------------------------------------------------------------

describe('cartLineUnitPrice', () => {
  it('returns price_at_addition when positive', () => {
    const item = makeCartLine({ price_at_addition: 250 })
    expect(cartLineUnitPrice(item)).toBe(250)
  })

  it('falls back to products.base_price when price_at_addition is 0', () => {
    const item = makeCartLine({ price_at_addition: 0 })
    expect(cartLineUnitPrice(item)).toBe(100)
  })

  it('uses sub_variant price_ex_gst first in fallback chain', () => {
    const item = makeCartLine({
      price_at_addition: 0,
      sub_variant: { id: 'sv-1', sub_variant_name: 'S', sku: null, price: 80, price_ex_gst: 70 },
    })
    // price_at_addition is 0 → falls back to basePrice = sub_variant.price_ex_gst = 70
    expect(cartLineUnitPrice(item)).toBe(70)
  })

  it('uses variant price_ex_gst when sub_variant is absent', () => {
    const item = makeCartLine({
      price_at_addition: 0,
      variant: { id: 'v-1', variant_name: 'Red', sku: 'RED', price: 90, price_ex_gst: 85 },
    })
    expect(cartLineUnitPrice(item)).toBe(85)
  })

  it('uses products.price_ex_gst when variant absent', () => {
    const item = makeCartLine({
      price_at_addition: 0,
      products: { ...makeCartLine().products, price_ex_gst: 95, base_price: 110 },
    })
    expect(cartLineUnitPrice(item)).toBe(95)
  })

  it('falls back to sub_variant.price when price_ex_gst is null', () => {
    const item = makeCartLine({
      price_at_addition: 0,
      sub_variant: { id: 'sv-1', sub_variant_name: 'S', sku: null, price: 80, price_ex_gst: null },
      products: { ...makeCartLine().products, price_ex_gst: null },
    })
    expect(cartLineUnitPrice(item)).toBe(80)
  })

  it('falls back to variant.price when price_ex_gst fields are null', () => {
    const item = makeCartLine({
      price_at_addition: 0,
      variant: { id: 'v-1', variant_name: 'Blue', sku: 'BLU', price: 75, price_ex_gst: null },
      products: { ...makeCartLine().products, price_ex_gst: null },
    })
    expect(cartLineUnitPrice(item)).toBe(75)
  })
})

// ---------------------------------------------------------------------------
// cartItemsForHash
// ---------------------------------------------------------------------------

describe('cartItemsForHash', () => {
  it('maps cart lines to DraftCartItem shape', () => {
    const items = [makeCartLine({ quantity: 3, price_at_addition: 50 })]
    const result = cartItemsForHash(items)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      quantity: 3,
      buyMode: 'unit',
      buyUnit: null,
      priceAtAddition: 50,
    })
  })

  it('handles multiple items', () => {
    const items = [makeCartLine(), makeCartLine({ product_id: 'prod-2', quantity: 1 })]
    expect(cartItemsForHash(items)).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(cartItemsForHash([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// cartSubtotal
// ---------------------------------------------------------------------------

describe('cartSubtotal', () => {
  it('sums price * quantity for each item', () => {
    const items = [
      makeCartLine({ price_at_addition: 100, quantity: 2 }),
      makeCartLine({ price_at_addition: 50, quantity: 3 }),
    ]
    expect(cartSubtotal(items)).toBe(350)
  })

  it('returns 0 for empty cart', () => {
    expect(cartSubtotal([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// cartTaxAmount
// ---------------------------------------------------------------------------

describe('cartTaxAmount', () => {
  it('calculates tax as inclusive portion of each line total', () => {
    // line: 100 * 2 = 200, gst 18% → tax = 200 - 200/1.18 ≈ 30.51
    const items = [makeCartLine({ price_at_addition: 100, quantity: 2 })]
    const tax = cartTaxAmount(items)
    expect(tax).toBeCloseTo(200 - 200 / 1.18, 1)
  })

  it('returns 0 tax when gst_percentage is 0', () => {
    const item = makeCartLine({
      price_at_addition: 100,
      quantity: 1,
      products: { ...makeCartLine().products, gst_percentage: '0' },
    })
    expect(cartTaxAmount([item])).toBe(0)
  })

  it('returns 0 for empty array', () => {
    expect(cartTaxAmount([])).toBe(0)
  })

  it('handles null gst_percentage', () => {
    const item = makeCartLine({
      price_at_addition: 100,
      quantity: 1,
      products: { ...makeCartLine().products, gst_percentage: null },
    })
    expect(cartTaxAmount([item])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// resolveBuyNowItem
// ---------------------------------------------------------------------------

describe('resolveBuyNowItem', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns error when productId is missing', async () => {
    const result = await resolveBuyNowItem({ productId: '', qty: 1 })
    expect(result).toEqual({ ok: false, error: 'productId required' })
  })

  it('returns error for qty <= 0', async () => {
    const result = await resolveBuyNowItem({ productId: 'p1', qty: 0 })
    expect(result).toEqual({ ok: false, error: 'Invalid qty' })
  })

  it('returns error for qty > 10000', async () => {
    const result = await resolveBuyNowItem({ productId: 'p1', qty: 10001 })
    expect(result).toEqual({ ok: false, error: 'Invalid qty' })
  })

  it('returns error when product not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await resolveBuyNowItem({ productId: 'p1', qty: 1 })
    expect(result).toEqual({ ok: false, error: 'Product not found or inactive' })
  })

  it('returns error when product is inactive', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'p1', is_active: false, base_price: 100 })
    const result = await resolveBuyNowItem({ productId: 'p1', qty: 1 })
    expect(result).toEqual({ ok: false, error: 'Product not found or inactive' })
  })

  it('returns error when variant not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'p1', is_active: true, base_price: 100 })
      .mockResolvedValueOnce(null)
    const result = await resolveBuyNowItem({ productId: 'p1', variantId: 'v1', qty: 1 })
    expect(result).toEqual({ ok: false, error: 'Variant not found' })
  })

  it('returns error when sub-variant not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'p1', is_active: true, base_price: 100 })
      .mockResolvedValueOnce({ id: 'v1', price: 90 })
      .mockResolvedValueOnce(null)
    const result = await resolveBuyNowItem({ productId: 'p1', variantId: 'v1', subVariantId: 'sv1', qty: 1 })
    expect(result).toEqual({ ok: false, error: 'Sub-variant not found' })
  })

  it('returns resolved item using base_price when no variant', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'p1', is_active: true, base_price: 200 })
    const result = await resolveBuyNowItem({ productId: 'p1', qty: 2 })
    expect(result).toEqual({
      ok: true,
      item: {
        productId: 'p1',
        variantId: null,
        subVariantId: null,
        qty: 2,
        buyMode: 'unit',
        buyUnit: null,
        price: 200,
      },
    })
  })

  it('uses variant price when variant present', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'p1', is_active: true, base_price: 100 })
      .mockResolvedValueOnce({ id: 'v1', price: 150 })
    const result = await resolveBuyNowItem({ productId: 'p1', variantId: 'v1', qty: 1 })
    expect(result).toMatchObject({ ok: true, item: { price: 150, variantId: 'v1' } })
  })

  it('uses sub-variant price when sub-variant present', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'p1', is_active: true, base_price: 100 })
      .mockResolvedValueOnce({ id: 'v1', price: 150 })
      .mockResolvedValueOnce({ id: 'sv1', price: 130 })
    const result = await resolveBuyNowItem({ productId: 'p1', variantId: 'v1', subVariantId: 'sv1', qty: 1 })
    expect(result).toMatchObject({ ok: true, item: { price: 130, subVariantId: 'sv1' } })
  })

  it('applies unit factor when buyMode is not "unit"', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'p1', is_active: true, base_price: 100 })
      .mockResolvedValueOnce({ id: 'v1', price: 100 })
      .mockResolvedValueOnce({ factor: '12' })  // unit row — e.g. dozen
    const result = await resolveBuyNowItem({ productId: 'p1', variantId: 'v1', qty: 1, buyMode: 'dozen' })
    expect(result).toMatchObject({ ok: true, item: { price: 1200 } })
  })

  it('returns error when resolved price is <= 0', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'p1', is_active: true, base_price: 0 })
    const result = await resolveBuyNowItem({ productId: 'p1', qty: 1 })
    expect(result).toEqual({ ok: false, error: 'Could not resolve price for this product' })
  })

  it('rounds price to 2 decimal places', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'p1', is_active: true, base_price: 33.333 })
    const result = await resolveBuyNowItem({ productId: 'p1', qty: 1 })
    expect(result).toMatchObject({ ok: true, item: { price: 33.33 } })
  })
})

// ---------------------------------------------------------------------------
// validateCouponForUser
// ---------------------------------------------------------------------------

describe('validateCouponForUser', () => {
  beforeEach(() => vi.resetAllMocks())

  function makeCoupon(overrides: Record<string, any> = {}) {
    return {
      id: 'coup-1',
      discount_type: 'flat',
      discount_value: 50,
      min_purchase_amount: null,
      max_discount_amount: null,
      usage_limit: null,
      usage_limit_per_user: null,
      times_used: 0,
      valid_from: null,
      valid_until: null,
      is_active: true,
      generated_for_user_id: null,
      ...overrides,
    }
  }

  it('returns inactive when coupon not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 0, ok: false, reason: 'inactive' })
  })

  it('returns inactive when coupon is_active=false', async () => {
    mockQueryOne.mockResolvedValueOnce(makeCoupon({ is_active: false }))
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 0, ok: false, reason: 'inactive' })
  })

  it('returns not_assigned_to_user when generated_for_user_id does not match', async () => {
    mockQueryOne.mockResolvedValueOnce(makeCoupon({ generated_for_user_id: 'other-user' }))
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 0, ok: false, reason: 'not_assigned_to_user' })
  })

  it('allows when generated_for_user_id matches', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ generated_for_user_id: 'u1' }))
      .mockResolvedValueOnce({ cnt: '0' })  // eligible list count = 0
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 200 })
    expect(r.ok).toBe(true)
    expect(r.appliedDiscount).toBe(50)
  })

  it('returns not_assigned_to_user when eligible list exists but user not in it', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon())
      .mockResolvedValueOnce({ cnt: '2' })          // eligible count > 0
      .mockResolvedValueOnce({ cnt: '0' })           // user not in list
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 0, ok: false, reason: 'not_assigned_to_user' })
  })

  it('allows when eligible list exists and user is in it', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon())
      .mockResolvedValueOnce({ cnt: '1' })           // eligible list non-empty
      .mockResolvedValueOnce({ cnt: '1' })           // user in list
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 200 })
    expect(r.ok).toBe(true)
  })

  it('returns not_yet_valid when valid_from is in the future', async () => {
    const future = new Date(Date.now() + 86400_000).toISOString()
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ valid_from: future }))
      .mockResolvedValueOnce({ cnt: '0' })
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 0, ok: false, reason: 'not_yet_valid' })
  })

  it('returns expired when valid_until is in the past', async () => {
    const past = new Date(Date.now() - 86400_000).toISOString()
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ valid_until: past }))
      .mockResolvedValueOnce({ cnt: '0' })
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 0, ok: false, reason: 'expired' })
  })

  it('returns global_limit_reached when usage_limit hit', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ usage_limit: 10, times_used: 10 }))
      .mockResolvedValueOnce({ cnt: '0' })
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 0, ok: false, reason: 'global_limit_reached' })
  })

  it('returns per_user_limit_reached when user has used coupon too many times', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ usage_limit_per_user: 1 }))
      .mockResolvedValueOnce({ cnt: '0' })     // eligible list
      .mockResolvedValueOnce({ cnt: '1' })     // per-user usage >= limit
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 0, ok: false, reason: 'per_user_limit_reached' })
  })

  it('returns below_min_purchase when subtotal is below minimum', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ min_purchase_amount: 500 }))
      .mockResolvedValueOnce({ cnt: '0' })
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 200 })
    expect(r).toEqual({ appliedDiscount: 0, ok: false, reason: 'below_min_purchase' })
  })

  it('applies flat discount correctly', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ discount_type: 'flat', discount_value: 30 }))
      .mockResolvedValueOnce({ cnt: '0' })
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 30, ok: true })
  })

  it('applies percentage discount correctly', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ discount_type: 'percentage', discount_value: 10 }))
      .mockResolvedValueOnce({ cnt: '0' })
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 200 })
    expect(r).toEqual({ appliedDiscount: 20, ok: true })
  })

  it('caps percentage discount to max_discount_amount', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ discount_type: 'percentage', discount_value: 50, max_discount_amount: 40 }))
      .mockResolvedValueOnce({ cnt: '0' })
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 200 })
    expect(r).toEqual({ appliedDiscount: 40, ok: true })
  })

  it('caps discount to subtotal amount', async () => {
    mockQueryOne
      .mockResolvedValueOnce(makeCoupon({ discount_type: 'flat', discount_value: 500 }))
      .mockResolvedValueOnce({ cnt: '0' })
    const r = await validateCouponForUser({ couponId: 'c1', userId: 'u1', subtotal: 100 })
    expect(r).toEqual({ appliedDiscount: 100, ok: true })
  })
})

// ---------------------------------------------------------------------------
// loadAddress
// ---------------------------------------------------------------------------

describe('loadAddress', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls queryOne with address and user id', async () => {
    const addr = makeAddress()
    mockQueryOne.mockResolvedValue(addr)
    const result = await loadAddress('user-1', 'addr-1')
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('addresses'),
      ['addr-1', 'user-1']
    )
    expect(result).toBe(addr)
  })

  it('returns null when address not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const result = await loadAddress('user-1', 'missing')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getMinOrderAmount
// ---------------------------------------------------------------------------

describe('getMinOrderAmount', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns parsed float from settings row', async () => {
    mockQueryOne.mockResolvedValue({ value: '250.50' })
    expect(await getMinOrderAmount()).toBe(250.50)
  })

  it('returns 0 when row is null', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect(await getMinOrderAmount()).toBe(0)
  })

  it('returns 0 when value is non-numeric', async () => {
    mockQueryOne.mockResolvedValue({ value: 'abc' })
    expect(await getMinOrderAmount()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// quoteShipping
// ---------------------------------------------------------------------------

describe('quoteShipping', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns charge from successful response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ charge: 50 }),
    } as Response)
    const result = await quoteShipping({
      destinationPin: '492001',
      items: [{ productId: 'p1', quantity: 1 }],
      subtotal: 500,
    })
    expect(result).toBe(50)
  })

  it('returns 0 when fetch response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
    const result = await quoteShipping({
      destinationPin: '492001',
      items: [],
      subtotal: 0,
    })
    expect(result).toBe(0)
  })

  it('returns 0 when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network'))
    const result = await quoteShipping({
      destinationPin: '492001',
      items: [],
      subtotal: 0,
    })
    expect(result).toBe(0)
  })

  it('returns 0 when charge is negative', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ charge: -10 }),
    } as Response)
    const result = await quoteShipping({ destinationPin: '492001', items: [], subtotal: 100 })
    expect(result).toBe(0)
  })

  it('returns 0 when charge is not finite', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ charge: null }),
    } as Response)
    const result = await quoteShipping({ destinationPin: '492001', items: [], subtotal: 100 })
    expect(result).toBe(0)
  })

  it('rounds charge to 2 decimal places', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ charge: 49.999 }),
    } as Response)
    const result = await quoteShipping({ destinationPin: '492001', items: [], subtotal: 100 })
    expect(result).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// findExistingUnpaidRazorpayOrder
// ---------------------------------------------------------------------------

describe('findExistingUnpaidRazorpayOrder', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns order when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'ord-1', order_number: 'ORD-123' })
    const r = await findExistingUnpaidRazorpayOrder('user-1')
    expect(r).toEqual({ id: 'ord-1', order_number: 'ORD-123' })
  })

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const r = await findExistingUnpaidRazorpayOrder('user-1')
    expect(r).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// commitOrder — cart mode
// ---------------------------------------------------------------------------

describe('commitOrder — cart mode', () => {
  beforeEach(() => vi.resetAllMocks())

  function makeCartCommitInput(overrides: Record<string, any> = {}) {
    return {
      mode: 'cart' as const,
      userId: 'user-1',
      user: { email: 'test@example.com', phone: '9999999999', first_name: 'Test', last_name: 'User' },
      addressId: 'addr-1',
      notes: null,
      couponId: null,
      shippingAmount: 0,
      paymentRecord: null,
      cartItems: [makeCartLine()],
      subtotal: 200,
      taxAmount: 30,
      appliedDiscount: 0,
      ...overrides,
    }
  }

  function makeClient(orderRow = { id: 'ord-1', order_number: 'ORD-001', total_amount: '200', status: 'pending' }) {
    return {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [makeAddress()] })    // ensureAddressOnOrder
        .mockResolvedValueOnce({ rows: [orderRow] })         // INSERT orders
        .mockResolvedValue({ rows: [] }),                    // subsequent queries
    }
  }

  it('returns the created order', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    const result = await commitOrder(makeCartCommitInput())
    expect(result).toMatchObject({ id: 'ord-1', order_number: 'ORD-001' })
  })

  it('throws when address not found', async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }),  // address not found
    }
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await expect(commitOrder(makeCartCommitInput())).rejects.toThrow('Address not found')
  })

  it('deletes cart items after order insert', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeCartCommitInput())

    const calls = client.query.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some((sql: string) => sql.includes('DELETE FROM cart_items'))).toBe(true)
  })

  it('records coupon usage when couponId and appliedDiscount > 0', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeCartCommitInput({ couponId: 'coup-1', appliedDiscount: 20 }))

    const calls = client.query.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some((sql: string) => sql.includes('INSERT INTO coupon_usage'))).toBe(true)
    expect(calls.some((sql: string) => sql.includes('UPDATE coupons SET times_used'))).toBe(true)
  })

  it('does NOT record coupon when appliedDiscount is 0', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeCartCommitInput({ couponId: 'coup-1', appliedDiscount: 0 }))

    const calls = client.query.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some((sql: string) => sql.includes('INSERT INTO coupon_usage'))).toBe(false)
  })

  it('records payment when paymentRecord present', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeCartCommitInput({
      paymentRecord: { gatewayOrderId: 'rpay_ord_1', paymentId: 'rpay_pay_1', signature: 'sig', amountPaise: 20000 },
    }))

    const calls = client.query.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some((sql: string) => sql.includes('INSERT INTO payments'))).toBe(true)
  })

  it('does NOT insert payment when paymentRecord is null', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeCartCommitInput({ paymentRecord: null }))

    const calls = client.query.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some((sql: string) => sql.includes('INSERT INTO payments'))).toBe(false)
  })

  it('sets payment_status=paid and status=confirmed when paymentRecord provided', async () => {
    const client = makeClient({ id: 'ord-1', order_number: 'ORD-001', total_amount: '200', status: 'confirmed' })
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    const result = await commitOrder(makeCartCommitInput({
      paymentRecord: { gatewayOrderId: 'g1', paymentId: 'p1', signature: 's1', amountPaise: 20000 },
    }))

    expect(result.status).toBe('confirmed')
  })

  it('uses customer name as "Customer" when first/last name are null', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeCartCommitInput({
      user: { email: 'x@x.com', phone: null, first_name: null, last_name: null },
    }))

    const orderInsertCall = client.query.mock.calls[1]
    const params = orderInsertCall[1] as any[]
    expect(params[4]).toBe('Customer')  // customerName param
  })

  it('computes total = subtotal - discount + shipping', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeCartCommitInput({ subtotal: 300, appliedDiscount: 50, shippingAmount: 25 }))

    const orderInsertCall = client.query.mock.calls[1]
    const params = orderInsertCall[1] as any[]
    // total_amount is at index 11
    expect(params[11]).toBe(275)
  })

  it('handles cart item with variant and sub_variant for product name', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    const cartItem = makeCartLine({
      variant: { id: 'v1', variant_name: 'Large', sku: 'V1', price: 100, price_ex_gst: null },
      sub_variant: { id: 'sv1', sub_variant_name: 'Red', sku: 'SV1', price: 90, price_ex_gst: null },
    })
    await commitOrder(makeCartCommitInput({ cartItems: [cartItem] }))

    const orderItemCall = client.query.mock.calls.find((c: any[]) =>
      (c[0] as string).includes('INSERT INTO order_items')
    )
    expect(orderItemCall).toBeDefined()
    const params = orderItemCall![1] as any[]
    // productName is at index 4
    expect(params[4]).toBe('Widget - Large - Red')
  })
})

// ---------------------------------------------------------------------------
// commitOrder — buyNow mode
// ---------------------------------------------------------------------------

describe('commitOrder — buyNow mode', () => {
  beforeEach(() => vi.resetAllMocks())

  function makeBuyNowInput(overrides: Record<string, any> = {}) {
    return {
      mode: 'buyNow' as const,
      userId: 'user-1',
      user: { email: 'test@example.com', phone: null, first_name: 'Jane', last_name: null },
      addressId: 'addr-1',
      notes: 'urgent',
      couponId: null,
      shippingAmount: 50,
      paymentRecord: null,
      item: {
        productId: 'prod-1',
        variantId: null,
        subVariantId: null,
        qty: 1,
        buyMode: 'unit',
        buyUnit: null,
        price: 500,
      },
      product: { id: 'prod-1', name: 'Gadget', sku: 'GAD-001', gst_percentage: '12', hsn_code: '8502' },
      variant: null,
      subVariant: null,
      subtotal: 500,
      taxAmount: 53.57,
      appliedDiscount: 0,
      ...overrides,
    }
  }

  function makeClient(orderRow = { id: 'ord-2', order_number: 'ORD-002', total_amount: '550', status: 'pending' }) {
    return {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [makeAddress()] })
        .mockResolvedValueOnce({ rows: [orderRow] })
        .mockResolvedValue({ rows: [] }),
    }
  }

  it('returns created order for buyNow mode', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    const result = await commitOrder(makeBuyNowInput())
    expect(result).toMatchObject({ id: 'ord-2', order_number: 'ORD-002' })
  })

  it('does NOT delete cart items in buyNow mode', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeBuyNowInput())

    const calls = client.query.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.some((sql: string) => sql.includes('DELETE FROM cart_items'))).toBe(false)
  })

  it('inserts single order_item for buyNow', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeBuyNowInput())

    const itemCalls = client.query.mock.calls.filter((c: any[]) =>
      (c[0] as string).includes('INSERT INTO order_items')
    )
    expect(itemCalls).toHaveLength(1)
  })

  it('handles buyNow with variant and subVariant for naming', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeBuyNowInput({
      variant: { id: 'v1', variant_name: 'XL', sku: 'V1' },
      subVariant: { id: 'sv1', sub_variant_name: 'Blue', sku: null },
    }))

    const orderItemCall = client.query.mock.calls.find((c: any[]) =>
      (c[0] as string).includes('INSERT INTO order_items')
    )
    expect(orderItemCall).toBeDefined()
    const params = orderItemCall![1] as any[]
    expect(params[4]).toBe('Gadget - XL - Blue')
  })

  it('handles buyNow with variant only (no subVariant)', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeBuyNowInput({
      variant: { id: 'v1', variant_name: 'Medium', sku: 'V1' },
      subVariant: null,
    }))

    const orderItemCall = client.query.mock.calls.find((c: any[]) =>
      (c[0] as string).includes('INSERT INTO order_items')
    )
    const params = orderItemCall![1] as any[]
    expect(params[4]).toBe('Gadget - Medium')
  })

  it('uses fractional qty for non-unit buyMode', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeBuyNowInput({
      item: {
        productId: 'prod-1', variantId: null, subVariantId: null,
        qty: 2.5, buyMode: 'kg', buyUnit: 'kg', price: 100,
      },
    }))

    const orderItemCall = client.query.mock.calls.find((c: any[]) =>
      (c[0] as string).includes('INSERT INTO order_items')
    )
    const params = orderItemCall![1] as any[]
    // quantity is at index 7
    expect(params[7]).toBe(2.5)
  })

  it('rounds qty to integer for unit buyMode', async () => {
    const client = makeClient()
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client))

    await commitOrder(makeBuyNowInput({
      item: {
        productId: 'prod-1', variantId: null, subVariantId: null,
        qty: 2.9, buyMode: 'unit', buyUnit: null, price: 100,
      },
    }))

    const orderItemCall = client.query.mock.calls.find((c: any[]) =>
      (c[0] as string).includes('INSERT INTO order_items')
    )
    const params = orderItemCall![1] as any[]
    expect(params[7]).toBe(3)
  })
})
