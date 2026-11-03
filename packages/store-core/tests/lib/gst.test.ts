import { describe, it, expect } from 'vitest'
import { getStateCode, isInterState, calculateGST, getFinancialYear, generateInvoiceNumber } from '@/lib/catalog/gst'

// ---------------------------------------------------------------------------
// getStateCode
// ---------------------------------------------------------------------------
describe('getStateCode', () => {
  it('returns correct code for a known state (exact case)', () => {
    expect(getStateCode('karnataka')).toBe('29')
  })

  it('is case-insensitive', () => {
    expect(getStateCode('Karnataka')).toBe('29')
    expect(getStateCode('KARNATAKA')).toBe('29')
    expect(getStateCode('KaRnAtAkA')).toBe('29')
  })

  it('trims surrounding whitespace', () => {
    expect(getStateCode('  maharashtra  ')).toBe('27')
  })

  it('returns correct codes for several states', () => {
    expect(getStateCode('delhi')).toBe('07')
    expect(getStateCode('tamil nadu')).toBe('33')
    expect(getStateCode('west bengal')).toBe('19')
    expect(getStateCode('gujarat')).toBe('24')
    expect(getStateCode('uttar pradesh')).toBe('09')
    expect(getStateCode('kerala')).toBe('32')
    expect(getStateCode('telangana')).toBe('36')
    expect(getStateCode('andhra pradesh')).toBe('37')
    expect(getStateCode('ladakh')).toBe('38')
  })

  it('returns empty string for unknown state', () => {
    expect(getStateCode('nonexistent state')).toBe('')
    expect(getStateCode('xyz')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(getStateCode('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// isInterState
// ---------------------------------------------------------------------------
describe('isInterState', () => {
  it('returns false when buyer and seller are in the same state', () => {
    expect(isInterState('karnataka', '29')).toBe(false)
  })

  it('returns true when buyer and seller are in different states', () => {
    expect(isInterState('karnataka', '27')).toBe(true) // Karnataka vs Maharashtra
    expect(isInterState('delhi', '29')).toBe(true)
  })

  it('returns false when buyer state is unknown', () => {
    expect(isInterState('unknown state', '29')).toBe(false)
  })

  it('returns false when seller state code is empty', () => {
    expect(isInterState('karnataka', '')).toBe(false)
  })

  it('returns false when both are empty', () => {
    expect(isInterState('', '')).toBe(false)
  })

  it('is case-insensitive on buyer state', () => {
    expect(isInterState('KARNATAKA', '29')).toBe(false)
    expect(isInterState('Karnataka', '27')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// calculateGST
// ---------------------------------------------------------------------------
describe('calculateGST', () => {
  it('returns zero taxes when gstRate is 0', () => {
    const result = calculateGST(1000, 0, false)
    expect(result.taxableAmount).toBe(1000)
    expect(result.cgst).toBe(0)
    expect(result.sgst).toBe(0)
    expect(result.igst).toBe(0)
    expect(result.totalTax).toBe(0)
  })

  it('returns zero taxes when gstRate is negative', () => {
    const result = calculateGST(1000, -5, false)
    expect(result.totalTax).toBe(0)
    expect(result.taxableAmount).toBe(1000)
  })

  it('calculates CGST+SGST correctly for intra-state at 18%', () => {
    // 118 inclusive → taxable = 118/1.18 = 100
    const result = calculateGST(118, 18, false)
    expect(result.taxableAmount).toBe(100)
    expect(result.totalTax).toBe(18)
    expect(result.cgst).toBe(9)
    expect(result.sgst).toBe(9)
    expect(result.igst).toBe(0)
    expect(result.cgst + result.sgst).toBe(result.totalTax)
  })

  it('calculates IGST correctly for inter-state at 18%', () => {
    const result = calculateGST(118, 18, true)
    expect(result.taxableAmount).toBe(100)
    expect(result.totalTax).toBe(18)
    expect(result.igst).toBe(18)
    expect(result.cgst).toBe(0)
    expect(result.sgst).toBe(0)
  })

  it('calculates at 5% GST correctly', () => {
    const result = calculateGST(105, 5, false)
    expect(result.taxableAmount).toBe(100)
    expect(result.totalTax).toBe(5)
    expect(result.cgst).toBe(2.5)
    expect(result.sgst).toBe(2.5)
  })

  it('calculates at 12% GST correctly', () => {
    const result = calculateGST(112, 12, false)
    expect(result.taxableAmount).toBe(100)
    expect(result.totalTax).toBe(12)
    expect(result.cgst).toBe(6)
    expect(result.sgst).toBe(6)
  })

  it('calculates at 28% GST correctly', () => {
    const result = calculateGST(128, 28, false)
    expect(result.taxableAmount).toBe(100)
    expect(result.totalTax).toBe(28)
    expect(result.cgst).toBe(14)
    expect(result.sgst).toBe(14)
  })

  it('cgst + sgst always equals totalTax (rounding safety)', () => {
    // Use an odd amount that may cause rounding issues
    const result = calculateGST(999, 18, false)
    expect(result.cgst + result.sgst).toBeCloseTo(result.totalTax, 10)
  })

  it('handles price of 0', () => {
    const result = calculateGST(0, 18, false)
    expect(result.taxableAmount).toBe(0)
    expect(result.totalTax).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getFinancialYear
// ---------------------------------------------------------------------------
describe('getFinancialYear', () => {
  it('returns correct FY for a date in April (start of new FY)', () => {
    // April 1 2025 → FY 25-26
    expect(getFinancialYear(new Date('2025-04-01'))).toBe('25-26')
  })

  it('returns correct FY for a date in March (end of FY)', () => {
    // March 31 2025 → FY 24-25
    expect(getFinancialYear(new Date('2025-03-31'))).toBe('24-25')
  })

  it('returns correct FY for mid-year date', () => {
    expect(getFinancialYear(new Date('2024-10-15'))).toBe('24-25')
  })

  it('returns correct FY for January', () => {
    expect(getFinancialYear(new Date('2025-01-01'))).toBe('24-25')
  })

  it('returns correct FY for December', () => {
    expect(getFinancialYear(new Date('2025-12-31'))).toBe('25-26')
  })

  it('uses current date when no argument is provided', () => {
    // Just ensure it returns a string in the expected format xx-yy
    const fy = getFinancialYear()
    expect(fy).toMatch(/^\d{2}-\d{2}$/)
    const [start, end] = fy.split('-').map(Number)
    expect(end).toBe(start + 1)
  })
})

// ---------------------------------------------------------------------------
// generateInvoiceNumber
// ---------------------------------------------------------------------------
describe('generateInvoiceNumber', () => {
  it('generates the expected invoice number', () => {
    expect(generateInvoiceNumber('JSI', '25-26', 1)).toBe('JSI/25-26/001')
    expect(generateInvoiceNumber('JSI', '25-26', 42)).toBe('JSI/25-26/042')
    expect(generateInvoiceNumber('JSI', '25-26', 100)).toBe('JSI/25-26/100')
  })

  it('pads sequence to 3 digits', () => {
    expect(generateInvoiceNumber('PFX', '24-25', 5)).toBe('PFX/24-25/005')
  })

  it('does not truncate sequence numbers ≥1000', () => {
    expect(generateInvoiceNumber('PFX', '24-25', 1000)).toBe('PFX/24-25/1000')
  })

  it('handles different prefixes', () => {
    expect(generateInvoiceNumber('ABC', '25-26', 1)).toBe('ABC/25-26/001')
    expect(generateInvoiceNumber('', '25-26', 1)).toBe('/25-26/001')
  })
})
