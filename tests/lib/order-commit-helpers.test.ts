import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn(),
  calculateGST: vi.fn(),
}))

vi.mock('@/lib/invoice', () => ({
  createDraftInvoice: vi.fn(),
}))

import {
  cartLineUnitPrice,
  cartItemsForHash,
  cartSubtotal,
  cartTaxAmount,
  type CartLine,
} from '@/lib/order-commit'

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
  it('returns price_at_addition when it is positive', () => {
    const line = makeCartLine({ price_at_addition: 1200 })
    expect(cartLineUnitPrice(line)).toBe(1200)
  })

  it('falls back to products.price_ex_gst when price_at_addition is 0', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      products: makeProduct({ price_ex_gst: 847.46, base_price: 1000 }),
    })
    expect(cartLineUnitPrice(line)).toBe(847.46)
  })

  it('falls back to products.base_price when price_ex_gst is null and price_at_addition is 0', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      products: makeProduct({ price_ex_gst: null, base_price: 950 }),
    })
    expect(cartLineUnitPrice(line)).toBe(950)
  })

  it('prefers sub_variant.price_ex_gst over variant.price_ex_gst and product', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      variant: { id: 'v1', variant_name: 'Red', sku: 'V1', price: 1100, price_ex_gst: 932.2, mrp: null },
      sub_variant: { id: 'sv1', sub_variant_name: 'S', sku: 'SV1', price: 1200, price_ex_gst: 1016.95, mrp: null },
      products: makeProduct({ price_ex_gst: 847.46 }),
    })
    expect(cartLineUnitPrice(line)).toBe(1016.95)
  })

  it('prefers variant.price_ex_gst over product price when sub_variant is absent', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      variant: { id: 'v1', variant_name: 'Blue', sku: 'V1', price: 1050, price_ex_gst: 889.83, mrp: null },
      sub_variant: null,
      products: makeProduct({ price_ex_gst: 847.46 }),
    })
    expect(cartLineUnitPrice(line)).toBe(889.83)
  })

  it('falls back to sub_variant.price when sub_variant.price_ex_gst is null', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      sub_variant: { id: 'sv1', sub_variant_name: 'M', sku: null, price: 1300, price_ex_gst: null, mrp: null },
      products: makeProduct({ price_ex_gst: null }),
    })
    expect(cartLineUnitPrice(line)).toBe(1300)
  })

  it('falls back to variant.price when variant.price_ex_gst is null', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      variant: { id: 'v1', variant_name: 'Green', sku: 'V1', price: 1150, price_ex_gst: null, mrp: null },
      sub_variant: null,
      products: makeProduct({ price_ex_gst: null }),
    })
    expect(cartLineUnitPrice(line)).toBe(1150)
  })
})

// ---------------------------------------------------------------------------
// cartItemsForHash
// ---------------------------------------------------------------------------

describe('cartItemsForHash', () => {
  it('maps CartLine array to DraftCartItem shape', () => {
    const lines: CartLine[] = [
      makeCartLine({ product_id: 'p1', variant_id: 'v1', sub_variant_id: null, quantity: 2, price_at_addition: 500, buy_mode: 'unit', buy_unit: null }),
      makeCartLine({ product_id: 'p2', variant_id: null, sub_variant_id: 'sv2', quantity: 3, price_at_addition: 750, buy_mode: 'box', buy_unit: 'box' }),
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
    expect(cartSubtotal([])).toBe(0)
  })

  it('sums unitPrice * quantity for a single item using price_at_addition', () => {
    const line = makeCartLine({ price_at_addition: 500, quantity: 3 })
    expect(cartSubtotal([line])).toBe(1500)
  })

  it('sums across multiple items', () => {
    const lines = [
      makeCartLine({ price_at_addition: 500, quantity: 2 }),
      makeCartLine({ price_at_addition: 300, quantity: 4 }),
    ]
    expect(cartSubtotal(lines)).toBe(2200)
  })

  it('uses product base_price as fallback when price_at_addition is 0', () => {
    const line = makeCartLine({
      price_at_addition: 0,
      quantity: 2,
      products: makeProduct({ price_ex_gst: null, base_price: 800 }),
    })
    expect(cartSubtotal([line])).toBe(1600)
  })

  it('uses fractional quantity correctly', () => {
    const line = makeCartLine({ price_at_addition: 200, quantity: 2.5 })
    expect(cartSubtotal([line])).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// cartTaxAmount
// ---------------------------------------------------------------------------

describe('cartTaxAmount', () => {
  it('returns 0 for empty cart', () => {
    expect(cartTaxAmount([])).toBe(0)
  })

  it('computes tax using inclusive GST formula: lineTotal - lineTotal/(1 + rate/100)', () => {
    // lineTotal = 1180 (price_at_addition), gst_percentage = 18
    // tax = 1180 - 1180/1.18 = 1180 - 1000 = 180
    const line = makeCartLine({
      price_at_addition: 1180,
      quantity: 1,
      products: makeProduct({ gst_percentage: '18' }),
    })
    expect(cartTaxAmount([line])).toBeCloseTo(180, 2)
  })

  it('returns 0 tax for 0% GST item', () => {
    const line = makeCartLine({
      price_at_addition: 500,
      quantity: 2,
      products: makeProduct({ gst_percentage: '0' }),
    })
    expect(cartTaxAmount([line])).toBe(0)
  })

  it('handles null gst_percentage as 0%', () => {
    const line = makeCartLine({
      price_at_addition: 500,
      quantity: 1,
      products: makeProduct({ gst_percentage: null }),
    })
    expect(cartTaxAmount([line])).toBe(0)
  })

  it('sums tax across multiple items with different rates', () => {
    // item1: 1180 * 1 at 18% → tax = 180
    // item2: 550 * 1 at 10% → tax = 550 - 550/1.1 = 550 - 500 = 50
    const lines = [
      makeCartLine({ price_at_addition: 1180, quantity: 1, products: makeProduct({ gst_percentage: '18' }) }),
      makeCartLine({ price_at_addition: 550, quantity: 1, products: makeProduct({ gst_percentage: '10' }) }),
    ]
    expect(cartTaxAmount(lines)).toBeCloseTo(230, 2)
  })

  it('scales tax with quantity', () => {
    // 590 * 2 = 1180 at 18% → tax = 180
    const line = makeCartLine({
      price_at_addition: 590,
      quantity: 2,
      products: makeProduct({ gst_percentage: '18' }),
    })
    expect(cartTaxAmount([line])).toBeCloseTo(180, 2)
  })

  it('handles numeric gst_percentage (not just string)', () => {
    const line = makeCartLine({
      price_at_addition: 1180,
      quantity: 1,
      products: makeProduct({ gst_percentage: 18 }),
    })
    expect(cartTaxAmount([line])).toBeCloseTo(180, 2)
  })
})
