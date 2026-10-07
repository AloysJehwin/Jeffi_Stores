import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  humanizeLabel,
  formatINR,
  formatDate,
  numberToWords,
  normalizeDob,
  isValidDob,
  formatDob,
} from '@/lib/shared/format'

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

describe('normalizeDob', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a real past date unchanged', () => {
    expect(normalizeDob('1990-05-15')).toBe('1990-05-15')
    expect(normalizeDob('  1990-05-15  ')).toBe('1990-05-15')
  })

  it('rejects anything that is not a YYYY-MM-DD string', () => {
    for (const bad of [
      undefined,
      null,
      19900515,
      '',
      '15-05-1990',
      '1990/05/15',
      '1990-5-15',
      '1990-05-15T00:00:00Z',
    ]) {
      expect(normalizeDob(bad)).toBeNull()
    }
  })

  it('rejects calendar dates that do not exist', () => {
    expect(normalizeDob('1990-02-30')).toBeNull()
    expect(normalizeDob('1990-13-01')).toBeNull()
    expect(normalizeDob('1990-00-10')).toBeNull()
    expect(normalizeDob('2001-02-29')).toBeNull()
    expect(normalizeDob('2000-02-29')).toBe('2000-02-29')
  })

  it('rejects a date in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    expect(normalizeDob('2026-10-05')).toBeNull()
    expect(normalizeDob('2030-01-01')).toBeNull()
  })

  it('accepts a third birthday today and rejects one that is a day away', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    expect(normalizeDob('2023-10-04')).toBe('2023-10-04')
    expect(normalizeDob('2023-10-05')).toBeNull()
  })

  it('accepts age 120 and rejects age 121', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    expect(normalizeDob('1905-10-05')).toBe('1905-10-05')
    expect(normalizeDob('1905-10-04')).toBeNull()
  })
})

describe('isValidDob', () => {
  it('agrees with normalizeDob', () => {
    expect(isValidDob('1990-05-15')).toBe(true)
    expect(isValidDob('1990-02-30')).toBe(false)
    expect(isValidDob('')).toBe(false)
  })
})

describe('formatDob', () => {
  it('reads a pg DATE, a Date at local midnight, back as the same calendar day', () => {
    expect(formatDob(new Date(1990, 4, 15))).toBe('1990-05-15')
    expect(formatDob(new Date(2000, 0, 1))).toBe('2000-01-01')
  })

  it('does not lose a day in a timezone ahead of UTC', () => {
    const original = process.env.TZ
    process.env.TZ = 'Asia/Kolkata'
    try {
      const fromPg = new Date(1990, 4, 15)
      expect(fromPg.toISOString().slice(0, 10)).toBe('1990-05-14')
      expect(formatDob(fromPg)).toBe('1990-05-15')
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })

  it('does not gain a day in a timezone behind UTC', () => {
    const original = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      expect(formatDob(new Date(1990, 4, 15))).toBe('1990-05-15')
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })

  it('passes a date-only string through', () => {
    expect(formatDob('1990-05-15')).toBe('1990-05-15')
  })

  it('returns null for empty or non-date values', () => {
    for (const bad of [null, undefined, '', 'not a date', new Date('invalid'), 19900515, '1990-05-15T00:00:00.000Z']) {
      expect(formatDob(bad)).toBeNull()
    }
  })
})
