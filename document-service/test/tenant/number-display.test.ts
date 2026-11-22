import { describe, it, expect } from 'vitest'
import { round3, moneyInputValue, qtyInputValue, fmtQty } from '../../src/lib/number-display.js'

describe('number-display', () => {
  it('round3 strips float noise to 3dp', () => {
    expect(round3(999.9999679999)).toBe(1000)
    expect(round3(2.5)).toBe(2.5)
    expect(round3(1.23456)).toBe(1.235)
  })

  it('moneyInputValue: numbers rounded to paise, strings pass through, non-finite empties', () => {
    expect(moneyInputValue(10.129)).toBe(10.13)
    expect(moneyInputValue('10.')).toBe('10.')
    expect(moneyInputValue(NaN)).toBe('')
    expect(moneyInputValue(Infinity)).toBe('')
    expect(moneyInputValue(null)).toBe('')
    expect(moneyInputValue(undefined)).toBe('')
  })

  it('qtyInputValue: numbers rounded to 3dp, strings untouched, non-finite empties', () => {
    expect(qtyInputValue(2.50001)).toBe(2.5)
    expect(qtyInputValue('2.')).toBe('2.')
    expect(qtyInputValue(NaN)).toBe('')
    expect(qtyInputValue(null)).toBe('')
    expect(qtyInputValue(undefined)).toBe('')
  })

  it('fmtQty: null/empty → "", trailing zeros dropped, non-numeric → ""', () => {
    expect(fmtQty(null)).toBe('')
    expect(fmtQty(undefined)).toBe('')
    expect(fmtQty('')).toBe('')
    expect(fmtQty('abc')).toBe('')
    expect(fmtQty(2.5)).toBe('2.5')
    expect(fmtQty(3)).toBe('3')
    expect(fmtQty('2.500')).toBe('2.5')
  })
})
