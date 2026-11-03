import { describe, it, expect } from 'vitest'
import { round3, moneyInputValue, qtyInputValue, fmtQty } from '@/lib/shared/number-display'

describe('number-display', () => {
  it('round3 strips float noise', () => {
    expect(round3(0.1 + 0.2)).toBe(0.3)
    expect(round3(10.200000000000001)).toBe(10.2)
    expect(round3(1.23456)).toBe(1.235)
  })

  it('moneyInputValue rounds numbers to paise and leaves typed strings alone', () => {
    expect(moneyInputValue(999.9999679999999)).toBe(1000)
    expect(moneyInputValue(847.457627)).toBe(847.46)
    expect(moneyInputValue('10.')).toBe('10.')
    expect(moneyInputValue('')).toBe('')
    expect(moneyInputValue(null)).toBe('')
    expect(moneyInputValue(NaN)).toBe('')
  })

  it('qtyInputValue rounds numbers to 3dp and leaves strings alone', () => {
    expect(qtyInputValue(0.30000000000000004)).toBe(0.3)
    expect(qtyInputValue('2.')).toBe('2.')
    expect(qtyInputValue(undefined)).toBe('')
  })

  it('fmtQty trims trailing zeros and noise', () => {
    expect(fmtQty('5.000')).toBe('5')
    expect(fmtQty('2.500')).toBe('2.5')
    expect(fmtQty(1.2000000000000002)).toBe('1.2')
    expect(fmtQty(null)).toBe('')
    expect(fmtQty('abc')).toBe('')
  })
})
