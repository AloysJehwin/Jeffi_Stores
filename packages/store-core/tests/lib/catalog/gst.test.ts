import { describe, it, expect, vi } from 'vitest'
import {
  getStateCode,
  stateNameFromCode,
  isInterState,
  round2,
  calculateGST,
  getFinancialYear,
  generateInvoiceNumber,
  getNextInvoiceSequence,
} from '@/lib/catalog/gst'

describe('getStateCode', () => {
  it('maps a known state (case/space-insensitive)', () => {
    expect(getStateCode('Tamil Nadu')).toBe('33')
    expect(getStateCode('  KERALA  ')).toBe('32')
  })
  it('returns empty for unknown or empty', () => {
    expect(getStateCode('Atlantis')).toBe('')
    expect(getStateCode('')).toBe('')
  })
})

describe('stateNameFromCode', () => {
  it('reverses a code to Title Case', () => {
    expect(stateNameFromCode('22')).toBe('Chhattisgarh')
    expect(stateNameFromCode(' 33 ')).toBe('Tamil Nadu')
  })
  it('returns empty for null/undefined/unknown', () => {
    expect(stateNameFromCode(null)).toBe('')
    expect(stateNameFromCode(undefined)).toBe('')
    expect(stateNameFromCode('99')).toBe('')
  })
})

describe('isInterState', () => {
  it('true when buyer code differs from seller code', () => {
    expect(isInterState('Kerala', '33')).toBe(true) // 32 vs 33
  })
  it('false when they match', () => {
    expect(isInterState('Tamil Nadu', '33')).toBe(false)
  })
  it('false when buyer unknown or seller code blank', () => {
    expect(isInterState('Atlantis', '33')).toBe(false)
    expect(isInterState('Kerala', '')).toBe(false)
  })
})

describe('round2', () => {
  it('rounds to two decimals without drift', () => {
    expect(round2(1.005)).toBe(1) // toFixed quirk
    expect(round2(2.345)).toBe(2.35)
    expect(round2(10)).toBe(10)
  })
})

describe('calculateGST', () => {
  it('zero rate: whole price taxable, no tax', () => {
    expect(calculateGST(100, 0, false)).toEqual({ taxableAmount: 100, cgst: 0, sgst: 0, igst: 0, totalTax: 0 })
    expect(calculateGST(100, -5, true)).toEqual({ taxableAmount: 100, cgst: 0, sgst: 0, igst: 0, totalTax: 0 })
  })
  it('IGST: full tax in igst', () => {
    const r = calculateGST(118, 18, true)
    expect(r.taxableAmount).toBe(100)
    expect(r.igst).toBe(18)
    expect(r.cgst).toBe(0)
    expect(r.sgst).toBe(0)
    expect(r.totalTax).toBe(18)
  })
  it('CGST/SGST: split halves summing to total', () => {
    const r = calculateGST(118, 18, false)
    expect(r.taxableAmount).toBe(100)
    expect(r.cgst).toBe(9)
    expect(r.sgst).toBe(9)
    expect(r.igst).toBe(0)
    expect(r.cgst + r.sgst).toBe(r.totalTax)
  })
  it('odd total tax splits so halves still sum exactly', () => {
    const r = calculateGST(105, 5, false) // taxable 100, tax 5
    expect(r.totalTax).toBe(5)
    expect(r.cgst).toBe(2.5)
    expect(r.sgst).toBe(2.5)
  })
})

describe('getFinancialYear', () => {
  it('April onwards: FY starts this year', () => {
    expect(getFinancialYear(new Date('2026-04-01T00:00:00Z'))).toBe('26-27')
    expect(getFinancialYear(new Date('2026-12-31T00:00:00Z'))).toBe('26-27')
  })
  it('before April: FY started last year', () => {
    expect(getFinancialYear(new Date('2026-03-31T00:00:00Z'))).toBe('25-26')
    expect(getFinancialYear(new Date('2026-01-15T00:00:00Z'))).toBe('25-26')
  })
  it('defaults to now when no date given', () => {
    expect(getFinancialYear()).toMatch(/^\d{2}-\d{2}$/)
  })
})

describe('generateInvoiceNumber', () => {
  it('pads sequence to 3 digits', () => {
    expect(generateInvoiceNumber('INV', '26-27', 7)).toBe('INV/26-27/007')
    expect(generateInvoiceNumber('INV', '26-27', 1234)).toBe('INV/26-27/1234')
  })
})

describe('getNextInvoiceSequence', () => {
  it('returns max+1 from the client query', async () => {
    const client = { query: vi.fn<(...a: any[]) => any>(async () => ({ rows: [{ next_seq: '42' }] })) }
    const n = await getNextInvoiceSequence(client, '26-27')
    expect(n).toBe(42)
    expect(client.query).toHaveBeenCalledTimes(1)
    const [sql, params] = client.query.mock.calls[0]
    expect(sql).toContain('GREATEST')
    expect(params).toEqual(['26-27', '%/26-27/%'])
  })
})
