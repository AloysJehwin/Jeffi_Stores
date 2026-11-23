import { describe, it, expect } from 'vitest'
import {
  applyDiscount,
  stackDiscounts,
  lineItemExGst,
  lineItemInclGst,
  lineItemFromMrpIncl,
  mrpDiscountPct,
  pickUnitPrice,
  resolveLineUnitPrice,
} from '../src/lib/pricing.js'

describe('applyDiscount', () => {
  it('reduces by the given percentage', () => {
    expect(applyDiscount(200, 25)).toBe(150)
    expect(applyDiscount(200, 0)).toBe(200)
  })
})

describe('stackDiscounts', () => {
  it('stacks multiplicatively (30% + 10% = 37%)', () => {
    expect(stackDiscounts(30, 10)).toBe(37)
  })
})

describe('lineItemExGst / lineItemInclGst', () => {
  it('ex-GST applies qty, rate and discount', () => {
    expect(lineItemExGst(2, 100, 10)).toBe(180)
  })
  it('incl-GST adds the GST back', () => {
    expect(lineItemInclGst(2, 100, 10, 18)).toBeCloseTo(212.4, 10)
  })
})

describe('lineItemFromMrpIncl', () => {
  it('strips GST, discounts, re-adds GST (no discount is identity)', () => {
    expect(lineItemFromMrpIncl(1, 118, 0, 18)).toBeCloseTo(118, 10)
  })
  it('applies the discount against the ex-GST base', () => {
    // mrpEx = 100, 10% off → 90, +18% → 106.2
    expect(lineItemFromMrpIncl(1, 118, 10, 18)).toBeCloseTo(106.2, 10)
  })
})

describe('mrpDiscountPct', () => {
  it('rounds the off-MRP percentage', () => {
    expect(mrpDiscountPct(200, 150)).toBe(25)
  })
  it('returns 0 for null/0 mrp', () => {
    expect(mrpDiscountPct(null, 150)).toBe(0)
    expect(mrpDiscountPct(0, 150)).toBe(0)
  })
  it('returns 0 when mrp <= price', () => {
    expect(mrpDiscountPct(100, 150)).toBe(0)
    expect(mrpDiscountPct(150, 150)).toBe(0)
  })
})

describe('pickUnitPrice', () => {
  it('returns inclusive when GST enabled', () => {
    expect(pickUnitPrice({ inclusive: 118, exGst: 100 }, true)).toBe(118)
  })
  it('returns ex-GST when GST disabled', () => {
    expect(pickUnitPrice({ inclusive: 118, exGst: 100 }, false)).toBe(100)
  })
  it('falls back to inclusive when ex-GST is NULL', () => {
    expect(pickUnitPrice({ inclusive: 118, exGst: null }, false)).toBe(118)
  })
  it('falls back to inclusive when ex-GST is 0', () => {
    expect(pickUnitPrice({ inclusive: 118, exGst: 0 }, false)).toBe(118)
  })
  it('treats missing inclusive as 0', () => {
    expect(pickUnitPrice({ inclusive: null, exGst: null }, true)).toBe(0)
  })
})

describe('resolveLineUnitPrice', () => {
  const lv = (inclusive: number | null, exGst: number | null) => ({ inclusive, exGst })
  it('sub-variant wins when it has an inclusive value', () => {
    const r = resolveLineUnitPrice(
      { subVariant: lv(300, 250), variant: lv(200, 150), product: lv(100, 80) },
      true
    )
    expect(r).toBe(300)
  })
  it('variant wins when sub-variant is absent/zero', () => {
    const r = resolveLineUnitPrice(
      { subVariant: lv(0, 0), variant: lv(200, 150), product: lv(100, 80) },
      true
    )
    expect(r).toBe(200)
  })
  it('product wins when higher levels have no value', () => {
    const r = resolveLineUnitPrice(
      { subVariant: null, variant: null, product: lv(100, 80) },
      true
    )
    expect(r).toBe(100)
  })
  it('honours the GST flag at the winning level', () => {
    const r = resolveLineUnitPrice(
      { subVariant: lv(300, 250), variant: lv(200, 150), product: lv(100, 80) },
      false
    )
    expect(r).toBe(250)
  })
})
