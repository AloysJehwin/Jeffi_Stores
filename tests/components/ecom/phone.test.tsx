import { describe, it, expect } from 'vitest'
import { splitPhone, isValidPhone } from '@/app/(ecom)/ecom/_ui/phone'

describe('phone helpers', () => {
  it('splits E.164 on the longest country code', () => {
    expect(splitPhone('+971501234567')).toMatchObject({ country: { iso: 'AE' }, national: '501234567' })
    expect(splitPhone('+919876543210')).toMatchObject({ country: { iso: 'IN' }, national: '9876543210' })
  })
  it('treats a bare number as the fallback country', () => {
    expect(splitPhone('9876543210')).toMatchObject({ country: { iso: 'IN' }, national: '9876543210' })
  })
  it('validates length per country', () => {
    expect(isValidPhone('+919876543210')).toBe(true)
    expect(isValidPhone('+91987654321')).toBe(false)
    expect(isValidPhone('9876543210')).toBe(false)
    expect(isValidPhone('+6581234567')).toBe(true)
  })
})
