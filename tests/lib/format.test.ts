import { describe, it, expect } from 'vitest'
import { humanizeLabel, formatINR, formatDate, numberToWords } from '@/lib/format'

describe('humanizeLabel', () => {
  it('title-cases an underscore key', () => {
    expect(humanizeLabel('stainless_steel_tarnish_test_life')).toBe('Stainless Steel Tarnish Test Life')
  })

  it('preserves an acronym token', () => {
    expect(humanizeLabel('SST_life_for_red_rust')).toBe('SST Life For Red Rust')
  })

  it('capitalizes an already-clean single word', () => {
    expect(humanizeLabel('standard')).toBe('Standard')
  })

  it('leaves numeric/unit tokens unchanged', () => {
    expect(humanizeLabel('304L')).toBe('304L')
    expect(humanizeLabel('grade_304L')).toBe('Grade 304L')
    expect(humanizeLabel('304')).toBe('304')
  })

  it('is safe on empty input', () => {
    expect(humanizeLabel('')).toBe('')
  })

  it('collapses repeated separators', () => {
    expect(humanizeLabel('a__b  c')).toBe('A B C')
  })
})

describe('formatINR', () => {
  it('renders INR currency with two fraction digits by default', () => {
    const out = formatINR(1234.5)
    expect(out.startsWith('₹')).toBe(true)
    expect(out).toContain('.50')
  })

  it('drops fraction digits when asked for zero', () => {
    const out = formatINR(1234.5, 0)
    expect(out.startsWith('₹')).toBe(true)
    expect(out).not.toContain('.')
  })

  it('formats zero with the default two fraction digits', () => {
    expect(formatINR(0)).toContain('0.00')
  })
})

describe('formatDate', () => {
  it('returns the em-dash sentinel for an empty string by default', () => {
    expect(formatDate('')).toBe('—')
  })

  it('honours a custom empty sentinel', () => {
    expect(formatDate('', '')).toBe('')
  })

  it('renders day, short month and year for a valid date', () => {
    const out = formatDate('2024-01-05')
    expect(out).toContain('Jan')
    expect(out).toContain('2024')
    expect(out).toContain('05')
  })
})

describe('numberToWords', () => {
  it('names zero', () => {
    expect(numberToWords(0)).toBe('Zero')
  })

  it('names sub-hundred values', () => {
    expect(numberToWords(7)).toBe('Seven')
    expect(numberToWords(15)).toBe('Fifteen')
    expect(numberToWords(42)).toBe('Forty Two')
  })

  it('uses "and" after hundreds', () => {
    expect(numberToWords(100)).toBe('One Hundred')
    expect(numberToWords(105)).toBe('One Hundred and Five')
  })

  it('uses the Indian lakh/crore grouping', () => {
    expect(numberToWords(100000)).toBe('One Lakh')
    expect(numberToWords(1234)).toBe('One Thousand Two Hundred and Thirty Four')
    expect(numberToWords(12345678)).toBe(
      'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight'
    )
  })

  it('appends paise for fractional amounts', () => {
    expect(numberToWords(1234567.5)).toBe(
      'Twelve Lakh Thirty Four Thousand Five Hundred and Sixty Seven and Fifty paise'
    )
    expect(numberToWords(12345678.99)).toBe(
      'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight and Ninety Nine paise'
    )
  })
})
