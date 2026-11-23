import { describe, it, expect } from 'vitest'
import {
  getStateCode,
  isInterState,
  round2,
  calculateGST,
  getFinancialYear,
  generateInvoiceNumber,
  getNextInvoiceSequence,
} from '../src/lib/gst.js'

describe('getStateCode', () => {
  it('normalizes case/whitespace to the GST code', () => {
    expect(getStateCode('  Tamil Nadu ')).toBe('33')
    expect(getStateCode('KARNATAKA')).toBe('29')
  })
  it('returns empty for falsy or unknown states', () => {
    expect(getStateCode('')).toBe('')
    expect(getStateCode('Atlantis')).toBe('')
  })
})

describe('isInterState', () => {
  it('true when buyer/seller codes differ', () => {
    // Karnataka=29, seller 33 → inter-state
    expect(isInterState('Karnataka', '33')).toBe(true)
  })
  it('false when codes match', () => {
    expect(isInterState('Tamil Nadu', '33')).toBe(false)
  })
  it('false when a code is missing', () => {
    expect(isInterState('Atlantis', '33')).toBe(false)
    expect(isInterState('Karnataka', '')).toBe(false)
  })
})

describe('round2', () => {
  it('rounds to 2dp without IEEE drift', () => {
    expect(round2(1.005)).toBe(1) // 1.005.toFixed(2) === '1.00'
    expect(round2(2.675)).toBe(2.67)
  })
})

describe('calculateGST', () => {
  it('returns the price as taxable when rate <= 0', () => {
    expect(calculateGST(500, 0, false)).toEqual({
      taxableAmount: 500,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
    })
  })
  it('puts all tax in IGST inter-state', () => {
    // 1180 incl @18% → taxable 1000, tax 180
    expect(calculateGST(1180, 18, true)).toEqual({
      taxableAmount: 1000,
      cgst: 0,
      sgst: 0,
      igst: 180,
      totalTax: 180,
    })
  })
  it('splits CGST/SGST evenly intra-state', () => {
    expect(calculateGST(1180, 18, false)).toEqual({
      taxableAmount: 1000,
      cgst: 90,
      sgst: 90,
      igst: 0,
      totalTax: 180,
    })
  })
  it('handles an odd totalTax split so cgst+sgst = totalTax', () => {
    // 1000 incl @28% → taxable 781.25, totalTax 218.75
    const r = calculateGST(1000, 28, false)
    expect(r.taxableAmount).toBe(781.25)
    expect(r.totalTax).toBe(218.75)
    expect(r.cgst).toBe(109.38)
    expect(r.sgst).toBe(109.37)
    expect(round2(r.cgst + r.sgst)).toBe(r.totalTax)
  })
})

describe('getFinancialYear', () => {
  it('a March date belongs to the prior FY', () => {
    expect(getFinancialYear(new Date(2026, 2, 15))).toBe('25-26')
  })
  it('an April date starts a new FY', () => {
    expect(getFinancialYear(new Date(2026, 3, 1))).toBe('26-27')
  })
})

describe('generateInvoiceNumber', () => {
  it('pads the sequence to 3 digits', () => {
    expect(generateInvoiceNumber('INV', '25-26', 7)).toBe('INV/25-26/007')
    expect(generateInvoiceNumber('INV', '25-26', 1234)).toBe('INV/25-26/1234')
  })
})

describe('getNextInvoiceSequence', () => {
  it('parses next_seq from the query row', async () => {
    const client = { query: async () => ({ rows: [{ next_seq: '5' }] }) }
    await expect(getNextInvoiceSequence(client, '25-26')).resolves.toBe(5)
  })
})
