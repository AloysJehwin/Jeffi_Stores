import { describe, it, expect } from 'vitest'
import {
  getStateCode,
  stateFromCode,
  isInterState,
  round2,
  calculateGST,
  getFinancialYear,
  generateInvoiceNumber,
} from '../src/index'

describe('getStateCode', () => {
  it('returns empty string for falsy input', () => {
    expect(getStateCode('')).toBe('')
    expect(getStateCode(undefined as any)).toBe('')
  })
  it('normalizes case and whitespace then looks up', () => {
    expect(getStateCode('Tamil Nadu')).toBe('33')
    expect(getStateCode('  KARNATAKA  ')).toBe('29')
    expect(getStateCode('delhi')).toBe('07')
  })
  it('returns empty string for an unknown state', () => {
    expect(getStateCode('Narnia')).toBe('')
  })
})

describe('stateFromCode', () => {
  it('maps a code back to a title-cased state name', () => {
    expect(stateFromCode('33')).toBe('Tamil Nadu')
    expect(stateFromCode('07')).toBe('Delhi')
    expect(stateFromCode('29')).toBe('Karnataka')
  })
  it('returns empty string for an unknown code', () => {
    expect(stateFromCode('99')).toBe('')
  })
})

describe('isInterState', () => {
  it('false when the buyer state is unknown', () => {
    expect(isInterState('Narnia', '33')).toBe(false)
  })
  it('false when the seller state code is empty', () => {
    expect(isInterState('Tamil Nadu', '')).toBe(false)
  })
  it('false when buyer and seller are the same state (intra-state)', () => {
    expect(isInterState('Tamil Nadu', '33')).toBe(false)
  })
  it('true when buyer and seller differ (inter-state)', () => {
    expect(isInterState('Karnataka', '33')).toBe(true)
  })
})

describe('round2', () => {
  it('rounds to two decimals without float drift', () => {
    expect(round2(1.005)).toBe(1) // toFixed(2) of 1.005 → "1.00"
    expect(round2(2.345)).toBe(2.35)
    expect(round2(10)).toBe(10)
    expect(round2(-3.14159)).toBe(-3.14)
  })
})

describe('calculateGST', () => {
  it('returns no tax when rate is zero or negative', () => {
    expect(calculateGST(100, 0, false)).toEqual({ taxableAmount: 100, cgst: 0, sgst: 0, igst: 0, totalTax: 0 })
    expect(calculateGST(100, -5, true)).toEqual({ taxableAmount: 100, cgst: 0, sgst: 0, igst: 0, totalTax: 0 })
  })
  it('splits inclusive price into IGST for inter-state', () => {
    // 118 inclusive @ 18%: taxable = 118/1.18 = 100, tax = 18
    const r = calculateGST(118, 18, true)
    expect(r).toEqual({ taxableAmount: 100, cgst: 0, sgst: 0, igst: 18, totalTax: 18 })
  })
  it('splits into equal CGST/SGST for intra-state', () => {
    const r = calculateGST(118, 18, false)
    expect(r).toEqual({ taxableAmount: 100, cgst: 9, sgst: 9, igst: 0, totalTax: 18 })
  })
  it('keeps cgst+sgst equal to totalTax when half is not exact', () => {
    // 105 inclusive @ 5%: taxable = 105/1.05 = 100, tax = 5; half = 2.5 each
    const r = calculateGST(105, 5, false)
    expect(r.taxableAmount).toBe(100)
    expect(r.totalTax).toBe(5)
    expect(r.cgst).toBe(2.5)
    expect(r.sgst).toBe(2.5)
    expect(round2(r.cgst + r.sgst)).toBe(r.totalTax)
  })
  it('handles an odd total tax so the split still sums exactly', () => {
    // Craft a case where totalTax has an odd last cent.
    // 112.03 @ 12%: taxable = 112.03/1.12 = 100.026... → 100.03, tax = 12.00
    const r = calculateGST(112.03, 12, false)
    expect(round2(r.cgst + r.sgst)).toBe(r.totalTax)
    expect(r.igst).toBe(0)
  })
})

describe('getFinancialYear', () => {
  it('uses the current calendar year when month is April or later', () => {
    expect(getFinancialYear(new Date(2026, 3, 1))).toBe('26-27') // April
    expect(getFinancialYear(new Date(2026, 11, 31))).toBe('26-27') // December
  })
  it('rolls back a year for Jan/Feb/March', () => {
    expect(getFinancialYear(new Date(2026, 0, 15))).toBe('25-26') // January
    expect(getFinancialYear(new Date(2026, 2, 31))).toBe('25-26') // March
  })
  it('defaults to the current date when no arg is given', () => {
    expect(getFinancialYear()).toMatch(/^\d{2}-\d{2}$/)
  })
})

describe('generateInvoiceNumber', () => {
  it('pads the sequence to three digits', () => {
    expect(generateInvoiceNumber('INV', '26-27', 7)).toBe('INV/26-27/007')
  })
  it('does not truncate a sequence longer than three digits', () => {
    expect(generateInvoiceNumber('INV', '26-27', 1234)).toBe('INV/26-27/1234')
  })
})
