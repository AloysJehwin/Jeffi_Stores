import { describe, it, expect } from 'vitest'
import {
  humanizeLabel,
  formatINR,
  formatDate,
  normalizeDob,
  isValidDob,
  formatDob,
  numberToWords,
  MIN_AGE_YEARS,
  MAX_AGE_YEARS,
} from '../src/lib/format.js'

describe('humanizeLabel', () => {
  it('title-cases words and splits on separators', () => {
    expect(humanizeLabel('hello_world-foo bar')).toBe('Hello World Foo Bar')
  })
  it('keeps all-caps/number tokens verbatim', () => {
    // GST = all-caps kept; id2/v1 contain a digit so kept as-is; plain word title-cased
    expect(humanizeLabel('GST id2 v1 state')).toBe('GST id2 v1 State')
  })
  it('returns input when empty or only separators', () => {
    expect(humanizeLabel('')).toBe('')
    expect(humanizeLabel('___')).toBe('___')
  })
})

describe('formatINR', () => {
  it('groups a crore value with the Indian numbering system', () => {
    expect(formatINR(10000000)).toBe('₹1,00,00,000.00')
  })
  it('honours fractionDigits', () => {
    expect(formatINR(1234.5, 0)).toBe('₹1,235')
  })
})

describe('formatDate', () => {
  it('returns the empty marker for falsy input', () => {
    expect(formatDate('')).toBe('—')
    expect(formatDate('', 'n/a')).toBe('n/a')
  })
  it('formats an ISO date in en-IN', () => {
    expect(formatDate('2026-03-05')).toBe('05 Mar 2026')
  })
})

describe('normalizeDob / isValidDob', () => {
  it('accepts a valid in-range DOB', () => {
    expect(normalizeDob('2000-01-15')).toBe('2000-01-15')
    expect(isValidDob('2000-01-15')).toBe(true)
  })
  it('rejects non-strings and malformed strings', () => {
    expect(normalizeDob(20000115 as unknown)).toBeNull()
    expect(normalizeDob('2000/01/15')).toBeNull()
    expect(normalizeDob('abc')).toBeNull()
  })
  it('rejects an impossible calendar date', () => {
    expect(normalizeDob('2000-02-30')).toBeNull()
  })
  it('rejects a future DOB', () => {
    expect(normalizeDob('3000-01-01')).toBeNull()
  })
  it('enforces MIN_AGE_YEARS (too young)', () => {
    const now = new Date()
    const y = now.getUTCFullYear() - (MIN_AGE_YEARS - 1)
    const s = `${y}-01-01`
    expect(normalizeDob(s)).toBeNull()
  })
  it('enforces MAX_AGE_YEARS (too old)', () => {
    const now = new Date()
    const y = now.getUTCFullYear() - (MAX_AGE_YEARS + 1)
    const s = `${y}-01-01`
    expect(normalizeDob(s)).toBeNull()
  })
  it('isValidDob false for garbage', () => {
    expect(isValidDob('nope')).toBe(false)
  })
})

describe('formatDob', () => {
  it('formats a Date instance with local getters', () => {
    const d = new Date(2001, 2, 9) // 2001-03-09 local
    expect(formatDob(d)).toBe('2001-03-09')
  })
  it('returns null for an invalid Date', () => {
    expect(formatDob(new Date(NaN))).toBeNull()
  })
  it('passes through a valid ISO string and trims', () => {
    expect(formatDob(' 1999-12-31 ')).toBe('1999-12-31')
  })
  it('returns null for a bad string or non-string', () => {
    expect(formatDob('31-12-1999')).toBeNull()
    expect(formatDob(123 as unknown)).toBeNull()
  })
})

describe('numberToWords', () => {
  it('returns Zero for 0', () => {
    expect(numberToWords(0)).toBe('Zero')
  })
  it('spells crore/lakh/thousand/remainder and paise', () => {
    expect(numberToWords(10203045.5)).toBe('One Crore Two Lakh Three Thousand Forty Five and Fifty paise')
  })
  it('spells a hundreds group with "and"', () => {
    expect(numberToWords(345)).toBe('Three Hundred and Forty Five')
  })
  it('omits paise when none', () => {
    expect(numberToWords(1000)).toBe('One Thousand')
  })
})
