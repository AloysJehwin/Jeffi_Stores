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
} from '@/lib/catalog/pricing'

describe('applyDiscount', () => {
  it('applies a percentage', () => {
    expect(applyDiscount(100, 30)).toBe(70)
    expect(applyDiscount(100, 0)).toBe(100)
    expect(applyDiscount(100, 100)).toBe(0)
  })
})

describe('stackDiscounts', () => {
  it('stacks multiplicatively (30% + 10% = 37%)', () => {
    expect(stackDiscounts(30, 10)).toBeCloseTo(37, 6)
  })
  it('zero stays zero', () => {
    expect(stackDiscounts(0, 0)).toBe(0)
  })
})

describe('lineItemExGst', () => {
  it('qty * rate * (1 - disc)', () => {
    expect(lineItemExGst(2, 100, 10)).toBe(180)
  })
})

describe('lineItemInclGst', () => {
  it('adds GST on top of ex-GST line', () => {
    expect(lineItemInclGst(2, 100, 0, 18)).toBeCloseTo(236, 6)
    expect(lineItemInclGst(1, 100, 10, 18)).toBeCloseTo(106.2, 6)
  })
})

describe('lineItemFromMrpIncl', () => {
  it('strips, discounts, re-adds GST — net discount preserved', () => {
    // 1 unit, MRP incl 118 (ex 100), 10% off, 18% gst → ex 90 → incl 106.2
    expect(lineItemFromMrpIncl(1, 118, 10, 18)).toBeCloseTo(106.2, 6)
  })
  it('no discount returns the MRP incl', () => {
    expect(lineItemFromMrpIncl(2, 118, 0, 18)).toBeCloseTo(236, 6)
  })
})

describe('mrpDiscountPct', () => {
  it('rounds the off-MRP percentage', () => {
    expect(mrpDiscountPct(100, 70)).toBe(30)
    expect(mrpDiscountPct(99, 70)).toBe(29) // rounded
  })
  it('returns 0 when mrp falsy or <= price', () => {
    expect(mrpDiscountPct(null, 70)).toBe(0)
    expect(mrpDiscountPct(undefined, 70)).toBe(0)
    expect(mrpDiscountPct(0, 70)).toBe(0)
    expect(mrpDiscountPct(50, 70)).toBe(0)
    expect(mrpDiscountPct(70, 70)).toBe(0)
  })
})

describe('pickUnitPrice', () => {
  it('GST on → inclusive price', () => {
    expect(pickUnitPrice({ inclusive: 118, exGst: 100 }, true)).toBe(118)
  })
  it('GST off → ex-GST when positive', () => {
    expect(pickUnitPrice({ inclusive: 118, exGst: 100 }, false)).toBe(100)
  })
  it('GST off → falls back to inclusive when ex is null/0', () => {
    expect(pickUnitPrice({ inclusive: 118, exGst: null }, false)).toBe(118)
    expect(pickUnitPrice({ inclusive: 118, exGst: 0 }, false)).toBe(118)
  })
  it('treats missing inclusive as 0', () => {
    expect(pickUnitPrice({ inclusive: null, exGst: null }, true)).toBe(0)
  })
})

describe('resolveLineUnitPrice', () => {
  const lv = (inclusive: number | null, exGst: number | null) => ({ inclusive, exGst })

  it('sub-variant wins when it has a positive inclusive', () => {
    const price = resolveLineUnitPrice(
      { subVariant: lv(200, 170), variant: lv(150, 120), product: lv(100, 80) },
      true
    )
    expect(price).toBe(200)
  })
  it('falls to variant when sub-variant empty/absent', () => {
    expect(resolveLineUnitPrice({ subVariant: lv(0, 0), variant: lv(150, 120), product: lv(100, 80) }, true)).toBe(150)
    expect(resolveLineUnitPrice({ variant: lv(150, 120), product: lv(100, 80) }, true)).toBe(150)
  })
  it('falls to product when higher levels empty', () => {
    expect(resolveLineUnitPrice({ subVariant: null, variant: lv(null, null), product: lv(100, 80) }, true)).toBe(100)
  })
  it('honours the GST flag at the winning level', () => {
    expect(resolveLineUnitPrice({ product: lv(118, 100) }, false)).toBe(100)
  })
})
