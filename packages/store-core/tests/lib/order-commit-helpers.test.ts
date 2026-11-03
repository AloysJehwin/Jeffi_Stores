import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/catalog/gst', () => ({
  isInterState: vi.fn(),
  calculateGST: vi.fn(),
  round2: (n: number) => Math.round(n * 100) / 100,
}))

vi.mock('@/lib/documents/invoice', () => ({
  createDraftInvoice: vi.fn(),
}))

import { cartLineUnitPrice, cartItemsForHash, cartSubtotal, cartTaxAmount, type CartLine } from '@/lib/orders/order-commit'

beforeEach(() => vi.clearAllMocks())

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<CartLine['products']> = {}): CartLine['products'] {
  return {
    id: 'prod-1',
    name: 'Widget',
    sku: 'WGT-001',
    base_price: 1000,
    price_ex_gst: 847.46,
    gst_percentage: '18',
    hsn_code: '8443',
    category_id: null,
    mrp: null,
    extra_delivery_days: null,
    ...overrides,
  }
}

function makeCartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    product_id: 'prod-1',
    variant_id: null,
    sub_variant_id: null,
    quantity: 1,
    price_at_addition: 0,
    buy_mode: 'unit',
    buy_unit: null,
    products: makeProduct(),
    variant: null,
    sub_variant: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// cartLineUnitPrice
// ---------------------------------------------------------------------------

describe('cartLineUnitPrice', () => {
  // ── GST ON: charge the inclusive price (frozen price_at_addition or incl chain) ──
  it('GST on: returns price_at_addition when it is positive', () => {
    const line = makeCartLine({ price_at_addition: 1200 })
    expect(cartLineUnitPrice(line, true)).toBe(1200)
  })

  it('GST on: falls back to inclusive price (base_price) when price_at_addition is 0', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      products: makeProduct({ price_ex_gst: 847.46, base_price: 1000 }),
    })
    expect(cartLineUnitPrice(line, true)).toBe(1000)
  })

  it('GST on: prefers sub_variant.price then variant.price (inclusive)', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      variant: { id: 'v1', variant_name: 'Red', sku: 'V1', price: 1100, price_ex_gst: 932.2, mrp: null },
      sub_variant: { id: 'sv1', sub_variant_name: 'S', sku: 'SV1', price: 1200, price_ex_gst: 1016.95, mrp: null },
      products: makeProduct({ price_ex_gst: 847.46 }),
    })
    expect(cartLineUnitPrice(line, true)).toBe(1200)
  })

  // ── GST OFF: charge the ex-GST column, ignoring the frozen inclusive price ──
  it('GST off: uses products.price_ex_gst even when price_at_addition is set', () => {
    const line = makeCartLine({
      price_at_addition: 1000,
      products: makeProduct({ price_ex_gst: 847.46, base_price: 1000 }),
    })
    expect(cartLineUnitPrice(line, false)).toBe(847.46)
  })

  it('GST off: falls back to base_price when price_ex_gst is null', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      products: makeProduct({ price_ex_gst: null, base_price: 950 }),
    })
    expect(cartLineUnitPrice(line, false)).toBe(950)
  })

  it('GST off: prefers sub_variant.price_ex_gst over variant and product', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      variant: { id: 'v1', variant_name: 'Red', sku: 'V1', price: 1100, price_ex_gst: 932.2, mrp: null },
      sub_variant: { id: 'sv1', sub_variant_name: 'S', sku: 'SV1', price: 1200, price_ex_gst: 1016.95, mrp: null },
      products: makeProduct({ price_ex_gst: 847.46 }),
    })
    expect(cartLineUnitPrice(line, false)).toBe(1016.95)
  })

  it('GST off: prefers variant.price_ex_gst over product when sub_variant absent', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      variant: { id: 'v1', variant_name: 'Blue', sku: 'V1', price: 1050, price_ex_gst: 889.83, mrp: null },
      sub_variant: null,
      products: makeProduct({ price_ex_gst: 847.46 }),
    })
    expect(cartLineUnitPrice(line, false)).toBe(889.83)
  })

  it('GST off: falls back to sub_variant.price when its price_ex_gst is null', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      sub_variant: { id: 'sv1', sub_variant_name: 'M', sku: null, price: 1300, price_ex_gst: null, mrp: null },
      products: makeProduct({ price_ex_gst: null }),
    })
    expect(cartLineUnitPrice(line, false)).toBe(1300)
  })
})

// ---------------------------------------------------------------------------
// cartItemsForHash
// ---------------------------------------------------------------------------

describe('cartItemsForHash', () => {
  it('maps CartLine array to DraftCartItem shape', () => {
    const lines: CartLine[] = [
      makeCartLine({
        product_id: 'p1',
        variant_id: 'v1',
        sub_variant_id: null,
        quantity: 2,
        price_at_addition: 500,
        buy_mode: 'unit',
        buy_unit: null,
      }),
      makeCartLine({
        product_id: 'p2',
        variant_id: null,
        sub_variant_id: 'sv2',
        quantity: 3,
        price_at_addition: 750,
        buy_mode: 'box',
        buy_unit: 'box',
      }),
    ]
    const result = cartItemsForHash(lines)
    expect(result).toHaveLength(2)

    expect(result[0]).toEqual({
      productId: 'p1',
      variantId: 'v1',
      subVariantId: null,
      quantity: 2,
      buyMode: 'unit',
      buyUnit: null,
      priceAtAddition: 500,
    })

    expect(result[1]).toEqual({
      productId: 'p2',
      variantId: null,
      subVariantId: 'sv2',
      quantity: 3,
      buyMode: 'box',
      buyUnit: 'box',
      priceAtAddition: 750,
    })
  })

  it('returns empty array for empty input', () => {
    expect(cartItemsForHash([])).toEqual([])
  })

  it('coerces quantity to number', () => {
    const line = makeCartLine({ quantity: '2' as any, price_at_addition: 100 })
    const result = cartItemsForHash([line])
    expect(typeof result[0].quantity).toBe('number')
    expect(result[0].quantity).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// cartSubtotal
// ---------------------------------------------------------------------------

describe('cartSubtotal', () => {
  it('returns 0 for empty cart', () => {
    expect(cartSubtotal([], true)).toBe(0)
  })

  it('GST on: sums unitPrice * quantity using price_at_addition', () => {
    const line = makeCartLine({ price_at_addition: 500, quantity: 3 })
    expect(cartSubtotal([line], true)).toBe(1500)
  })

  it('GST on: sums across multiple items', () => {
    const lines = [
      makeCartLine({ price_at_addition: 500, quantity: 2 }),
      makeCartLine({ price_at_addition: 300, quantity: 4 }),
    ]
    expect(cartSubtotal(lines, true)).toBe(2200)
  })

  it('GST on: uses base_price fallback when price_at_addition is 0', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      quantity: 2,
      products: makeProduct({ price_ex_gst: null, base_price: 800 }),
    })
    expect(cartSubtotal([line], true)).toBe(1600)
  })

  it('GST on: uses fractional quantity correctly', () => {
    const line = makeCartLine({ price_at_addition: 200, quantity: 2.5 })
    expect(cartSubtotal([line], true)).toBe(500)
  })

  it('GST off: uses the ex-GST column instead of price_at_addition', () => {
    const line = makeCartLine({
      price_at_addition: 1000,
      quantity: 2,
      products: makeProduct({ price_ex_gst: 847.46, base_price: 1000 }),
    })
    expect(cartSubtotal([line], false)).toBeCloseTo(1694.92, 2)
  })
})

// ---------------------------------------------------------------------------
// cartTaxAmount
// ---------------------------------------------------------------------------

describe('cartTaxAmount', () => {
  it('returns 0 for empty cart', () => {
    expect(cartTaxAmount([], true)).toBe(0)
  })

  it('GST off: always returns 0 (no tax when charging ex-GST prices)', () => {
    const line = makeCartLine({ price_at_addition: 1180, quantity: 1, products: makeProduct({ gst_percentage: '18' }) })
    expect(cartTaxAmount([line], false)).toBe(0)
  })

  it('GST on: computes tax using inclusive formula lineTotal - lineTotal/(1 + rate/100)', () => {
    // lineTotal = 1180 (price_at_addition), gst_percentage = 18 → tax = 180
    const line = makeCartLine({
      price_at_addition: 1180,
      quantity: 1,
      products: makeProduct({ gst_percentage: '18' }),
    })
    expect(cartTaxAmount([line], true)).toBeCloseTo(180, 2)
  })

  it('GST on: returns 0 tax for 0% GST item', () => {
    const line = makeCartLine({
      price_at_addition: 500,
      quantity: 2,
      products: makeProduct({ gst_percentage: '0' }),
    })
    expect(cartTaxAmount([line], true)).toBe(0)
  })

  it('GST on: handles null gst_percentage as 0%', () => {
    const line = makeCartLine({
      price_at_addition: 500,
      quantity: 1,
      products: makeProduct({ gst_percentage: null }),
    })
    expect(cartTaxAmount([line], true)).toBe(0)
  })

  it('GST on: sums tax across multiple items with different rates', () => {
    const lines = [
      makeCartLine({ price_at_addition: 1180, quantity: 1, products: makeProduct({ gst_percentage: '18' }) }),
      makeCartLine({ price_at_addition: 550, quantity: 1, products: makeProduct({ gst_percentage: '10' }) }),
    ]
    expect(cartTaxAmount(lines, true)).toBeCloseTo(230, 2)
  })

  it('GST on: scales tax with quantity', () => {
    const line = makeCartLine({
      price_at_addition: 590,
      quantity: 2,
      products: makeProduct({ gst_percentage: '18' }),
    })
    expect(cartTaxAmount([line], true)).toBeCloseTo(180, 2)
  })

  it('GST on: handles numeric gst_percentage (not just string)', () => {
    const line = makeCartLine({
      price_at_addition: 1180,
      quantity: 1,
      products: makeProduct({ gst_percentage: 18 }),
    })
    expect(cartTaxAmount([line], true)).toBeCloseTo(180, 2)
  })
})
