import { describe, it, expect } from 'vitest'
import { inCartQuantity, pickerQtyCap, remainingUnitQty, unitCapError } from '@/lib/catalog/cart-unit-cap'

const line = (over: Partial<Record<string, unknown>> = {}) => ({
  product_id: 'p1',
  variant_id: 'v1',
  sub_variant_id: null,
  buy_mode: 'pc',
  quantity: 5,
  ...over,
})

describe('inCartQuantity', () => {
  it('counts only the same product + variant + sub-variant + unit line', () => {
    const items = [
      line(),
      line({ buy_mode: 'box', quantity: 2 }),
      line({ variant_id: 'v2', quantity: 7 }),
      line({ product_id: 'p2', quantity: 9 }),
      line({ sub_variant_id: 's1', quantity: 3 }),
    ] as any
    expect(inCartQuantity(items, { productId: 'p1', variantId: 'v1', buyMode: 'pc' })).toBe(5)
    expect(inCartQuantity(items, { productId: 'p1', variantId: 'v1', buyMode: 'box' })).toBe(2)
    expect(inCartQuantity(items, { productId: 'p1', variantId: 'v1', subVariantId: 's1', buyMode: 'pc' })).toBe(3)
    expect(inCartQuantity(items, { productId: 'p3', buyMode: 'pc' })).toBe(0)
  })

  it('treats a missing buy_mode as the plain unit line and coerces string quantities', () => {
    const items = [line({ variant_id: null, buy_mode: null, quantity: '2.5' })] as any
    expect(inCartQuantity(items, { productId: 'p1' })).toBe(2.5)
  })
})

describe('remainingUnitQty / unitCapError', () => {
  it('has no cap without max_qty', () => {
    expect(remainingUnitQty(null, 50)).toBeUndefined()
    expect(unitCapError(undefined, 50, 1000)).toBeNull()
  })

  it('subtracts the in-cart quantity from max_qty', () => {
    expect(remainingUnitQty(100, 5)).toBe(95)
    expect(remainingUnitQty(100, 120)).toBe(0)
    expect(remainingUnitQty(2.5, 1.2)).toBe(1.3)
  })

  it('explains how much more can be added', () => {
    expect(unitCapError(100, 5, 95)).toBeNull()
    expect(unitCapError(100, 5, 100)).toBe('You can add up to 95 more — 5 already in your cart (max 100)')
    expect(unitCapError(100, 100, 1)).toBe('Max quantity already in cart (max 100)')
  })
})

describe('pickerQtyCap', () => {
  it('caps the picker at max_qty minus the line already in cart', () => {
    expect(pickerQtyCap(100, 5)).toEqual({ inCart: 5, min: 1, max: 95, full: false })
  })

  it('is full once the line holds max_qty', () => {
    expect(pickerQtyCap(100, 100, 1)).toMatchObject({ max: 0, full: true })
  })

  it('stays uncapped without max_qty', () => {
    expect(pickerQtyCap(undefined, 40, 2)).toEqual({ inCart: 40, min: 2, max: undefined, full: false })
  })

  it('relaxes min_qty to the remainder for a top-up of an existing line', () => {
    expect(pickerQtyCap(100, 95, 10)).toMatchObject({ min: 5, max: 5 })
    expect(pickerQtyCap(100, 0, 10)).toMatchObject({ min: 10, max: 100 })
  })
})
