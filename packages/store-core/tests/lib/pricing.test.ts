import { describe, it, expect } from 'vitest'
import {
  applyDiscount,
  stackDiscounts,
  lineItemExGst,
  lineItemInclGst,
  lineItemFromMrpIncl,
  mrpDiscountPct,
} from '@/lib/catalog/pricing'

describe('applyDiscount', () => {
  it('returns original price when discount is 0', () => {
    expect(applyDiscount(1000, 0)).toBe(1000)
  })

  it('applies 10% discount correctly', () => {
    expect(applyDiscount(1000, 10)).toBe(900)
  })

  it('applies 100% discount to zero', () => {
    expect(applyDiscount(500, 100)).toBe(0)
  })

  it('applies 30% discount', () => {
    expect(applyDiscount(200, 30)).toBeCloseTo(140, 5)
  })

  it('handles fractional discount percentages', () => {
    expect(applyDiscount(1000, 12.5)).toBeCloseTo(875, 5)
  })

  it('handles zero price', () => {
    expect(applyDiscount(0, 20)).toBe(0)
  })
})

describe('stackDiscounts', () => {
  it('stacks 30% and 10% multiplicatively to ~37%', () => {
    expect(stackDiscounts(30, 10)).toBeCloseTo(37, 5)
  })

  it('returns 0 when both discounts are 0', () => {
    expect(stackDiscounts(0, 0)).toBe(0)
  })

  it('returns first discount when second is 0', () => {
    expect(stackDiscounts(20, 0)).toBeCloseTo(20, 5)
  })

  it('returns second discount when first is 0', () => {
    expect(stackDiscounts(0, 15)).toBeCloseTo(15, 5)
  })

  it('stacking is less than simple addition', () => {
    const stacked = stackDiscounts(20, 20)
    expect(stacked).toBeLessThan(40)
    expect(stacked).toBeCloseTo(36, 5)
  })

  it('two 50% discounts give 75% effective', () => {
    expect(stackDiscounts(50, 50)).toBeCloseTo(75, 5)
  })
})

describe('lineItemExGst', () => {
  it('computes qty * rate with no discount', () => {
    expect(lineItemExGst(5, 100, 0)).toBe(500)
  })

  it('applies discount to line total', () => {
    expect(lineItemExGst(2, 100, 10)).toBeCloseTo(180, 5)
  })

  it('handles zero qty', () => {
    expect(lineItemExGst(0, 100, 10)).toBe(0)
  })

  it('handles 100% discount', () => {
    expect(lineItemExGst(10, 200, 100)).toBe(0)
  })

  it('handles fractional rate', () => {
    expect(lineItemExGst(3, 33.33, 0)).toBeCloseTo(99.99, 2)
  })
})

describe('lineItemInclGst', () => {
  it('adds GST on top of ex-GST line total', () => {
    // 5 units * 100 rate * no discount = 500 ex-GST; +18% = 590
    expect(lineItemInclGst(5, 100, 0, 18)).toBeCloseTo(590, 5)
  })

  it('applies discount before adding GST', () => {
    // 2 * 100 * (1-10%) = 180 ex-GST; +18% = 212.4
    expect(lineItemInclGst(2, 100, 10, 18)).toBeCloseTo(212.4, 5)
  })

  it('handles 0% GST rate', () => {
    expect(lineItemInclGst(4, 50, 0, 0)).toBeCloseTo(200, 5)
  })

  it('handles 28% GST rate', () => {
    expect(lineItemInclGst(1, 100, 0, 28)).toBeCloseTo(128, 5)
  })

  it('handles zero qty', () => {
    expect(lineItemInclGst(0, 100, 0, 18)).toBe(0)
  })
})

describe('lineItemFromMrpIncl', () => {
  it('strips GST, applies discount, re-adds GST', () => {
    // mrpIncl=118, gstRate=18 => mrpEx=100; discount=0; total = 1 * 100 * 1.18 = 118
    expect(lineItemFromMrpIncl(1, 118, 0, 18)).toBeCloseTo(118, 5)
  })

  it('applies 10% discount on MRP-incl basis', () => {
    // mrpIncl=118, gstRate=18 => mrpEx=100; discount=10%; exGst=90; inclGst=90*1.18=106.2
    expect(lineItemFromMrpIncl(1, 118, 10, 18)).toBeCloseTo(106.2, 5)
  })

  it('scales with qty', () => {
    // 2 * lineItemFromMrpIncl(1, 118, 0, 18)
    expect(lineItemFromMrpIncl(2, 118, 0, 18)).toBeCloseTo(236, 5)
  })

  it('handles 5% GST', () => {
    // mrpIncl=105, gstRate=5 => mrpEx=100; incl=105
    expect(lineItemFromMrpIncl(1, 105, 0, 5)).toBeCloseTo(105, 5)
  })

  it('handles 100% discount', () => {
    expect(lineItemFromMrpIncl(5, 118, 100, 18)).toBeCloseTo(0, 5)
  })
})

describe('mrpDiscountPct', () => {
  it('returns 0 when mrp is null', () => {
    expect(mrpDiscountPct(null, 100)).toBe(0)
  })

  it('returns 0 when mrp is undefined', () => {
    expect(mrpDiscountPct(undefined, 100)).toBe(0)
  })

  it('returns 0 when mrp equals price', () => {
    expect(mrpDiscountPct(100, 100)).toBe(0)
  })

  it('returns 0 when mrp is less than price (price > mrp)', () => {
    expect(mrpDiscountPct(90, 100)).toBe(0)
  })

  it('returns 0 when mrp is 0 (falsy)', () => {
    expect(mrpDiscountPct(0, 100)).toBe(0)
  })

  it('computes 10% off correctly', () => {
    expect(mrpDiscountPct(1000, 900)).toBe(10)
  })

  it('computes 50% off correctly', () => {
    expect(mrpDiscountPct(200, 100)).toBe(50)
  })

  it('rounds to nearest integer', () => {
    // (1000 - 667) / 1000 = 33.3% -> rounds to 33
    expect(mrpDiscountPct(1000, 667)).toBe(33)
  })

  it('computes 25% off correctly', () => {
    expect(mrpDiscountPct(400, 300)).toBe(25)
  })
})
