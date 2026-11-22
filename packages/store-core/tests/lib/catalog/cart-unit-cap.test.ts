import { describe, it, expect } from 'vitest'
import {
  inCartQuantity,
  remainingUnitQty,
  unitCapError,
  pickerQtyCap,
  type CartLineLike,
} from '@/lib/catalog/cart-unit-cap'

const line = (over: Partial<CartLineLike> = {}): CartLineLike => ({
  product_id: 'p1',
  variant_id: null,
  sub_variant_id: null,
  buy_mode: null,
  quantity: 1,
  ...over,
})

describe('inCartQuantity', () => {
  it('sums matching lines (buy_mode null defaults to "unit")', () => {
    const items = [
      line({ quantity: 2 }),
      line({ quantity: '3' }),
      line({ product_id: 'other', quantity: 5 }),
      line({ variant_id: 'v1', quantity: 9 }),
      line({ buy_mode: 'bulk', quantity: 9 }),
    ]
    expect(inCartQuantity(items, { productId: 'p1' })).toBe(5)
  })
  it('matches on explicit buy_mode and variant/sub-variant', () => {
    const items = [line({ variant_id: 'v1', sub_variant_id: 'sv1', buy_mode: 'bulk', quantity: 4 })]
    expect(inCartQuantity(items, { productId: 'p1', variantId: 'v1', subVariantId: 'sv1', buyMode: 'bulk' })).toBe(4)
  })
  it('coerces bad quantity to 0', () => {
    expect(inCartQuantity([line({ quantity: 'x' as any })], { productId: 'p1' })).toBe(0)
  })
})

describe('remainingUnitQty', () => {
  it('undefined when no max', () => {
    expect(remainingUnitQty(null, 1)).toBeUndefined()
    expect(remainingUnitQty(undefined, 1)).toBeUndefined()
    expect(remainingUnitQty(NaN, 1)).toBeUndefined()
  })
  it('returns the remainder, clamped at 0', () => {
    expect(remainingUnitQty(10, 3)).toBe(7)
    expect(remainingUnitQty(10, 10)).toBe(0)
    expect(remainingUnitQty(10, 12)).toBe(0)
  })
  it('float-rounds to 6 dp', () => {
    expect(remainingUnitQty(1, 0.1)).toBe(0.9)
  })
})

describe('unitCapError', () => {
  it('null when uncapped or within cap', () => {
    expect(unitCapError(null, 0, 100)).toBeNull()
    expect(unitCapError(10, 3, 7)).toBeNull()
  })
  it('message when the line is already full', () => {
    expect(unitCapError(10, 10, 1)).toMatch(/Max quantity already in cart \(max 10\)/)
  })
  it('message with the remaining allowance', () => {
    const msg = unitCapError(10, 7, 5)
    expect(msg).toMatch(/add up to 3 more/)
    expect(msg).toMatch(/7 already/)
    expect(msg).toMatch(/max 10/)
  })
})

describe('pickerQtyCap', () => {
  it('uncapped line keeps min=minQty, max undefined', () => {
    expect(pickerQtyCap(null, 0, 2)).toEqual({ inCart: 0, min: 2, max: undefined, full: false })
  })
  it('full line reports full and min=minQty', () => {
    expect(pickerQtyCap(10, 10, 2)).toEqual({ inCart: 10, min: 2, max: 0, full: true })
  })
  it('relaxes min to the remaining top-up when the line exists', () => {
    // inCart>0, left=1, minQty=5 → min = min(5,1) = 1
    expect(pickerQtyCap(10, 9, 5)).toEqual({ inCart: 9, min: 1, max: 1, full: false })
  })
  it('default minQty is 1', () => {
    expect(pickerQtyCap(null, 0).min).toBe(1)
  })
})
