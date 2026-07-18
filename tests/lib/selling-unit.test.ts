import { describe, it, expect } from 'vitest'
import {
  toSellingUnit,
  toBaseQuantity,
  isStepMultiple,
  validatePurchaseQuantity,
  serialCountForQuantity,
  validateSerializedUnitStep,
  type SellingUnit,
} from '@/lib/selling-unit'

function unit(over: Partial<SellingUnit> = {}): SellingUnit {
  return { unit: 'm', factor: 1, dimension: 'length', qty_step: 0.5, min_qty: 0.5, max_qty: null, ...over }
}

describe('toSellingUnit', () => {
  it('returns null when there is no unit', () => {
    expect(toSellingUnit(null)).toBeNull()
    expect(toSellingUnit({ unit: null })).toBeNull()
  })

  it('coerces string numerics from pg and defaults factor/step', () => {
    const u = toSellingUnit({ unit: 'box', factor: '12', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null })
    expect(u).toEqual({ unit: 'box', factor: 12, dimension: 'count', qty_step: 1, min_qty: 1, max_qty: null })
  })

  it('never yields a zero factor or step', () => {
    const u = toSellingUnit({ unit: 'm', factor: '0', dimension: 'length', qty_step: '0', min_qty: '0' })!
    expect(u.factor).toBe(1)
    expect(u.qty_step).toBe(1)
  })
})

describe('toBaseQuantity', () => {
  it('multiplies count-dimension by factor', () => {
    expect(toBaseQuantity(2, unit({ dimension: 'count', factor: 12 }))).toBe(24)
  })
  it('passes measured dimensions through unchanged', () => {
    expect(toBaseQuantity(2.5, unit({ dimension: 'length', factor: 1 }))).toBe(2.5)
    expect(toBaseQuantity(3, unit({ dimension: 'area', factor: 5 }))).toBe(3)
  })
  it('passes through when unit is null', () => {
    expect(toBaseQuantity(4, null)).toBe(4)
  })
})

describe('isStepMultiple', () => {
  it('accepts exact multiples incl. fractional', () => {
    expect(isStepMultiple(2.5, 0.5)).toBe(true)
    expect(isStepMultiple(5, 5)).toBe(true)
    expect(isStepMultiple(0.3, 0.1)).toBe(true) // float-tolerant
  })
  it('rejects non-multiples', () => {
    expect(isStepMultiple(2.3, 0.5)).toBe(false)
    expect(isStepMultiple(7, 5)).toBe(false)
  })
  it('treats step <= 0 as unconstrained', () => {
    expect(isStepMultiple(3.14159, 0)).toBe(true)
  })
})

describe('validatePurchaseQuantity', () => {
  it('rejects zero/negative/non-finite', () => {
    expect(validatePurchaseQuantity(0, unit()).ok).toBe(false)
    expect(validatePurchaseQuantity(-1, unit()).ok).toBe(false)
    expect(validatePurchaseQuantity(NaN, unit()).ok).toBe(false)
  })

  it('null unit: whole numbers only', () => {
    expect(validatePurchaseQuantity(3, null).ok).toBe(true)
    expect(validatePurchaseQuantity(2.5, null).ok).toBe(false)
  })

  it('enforces min_qty', () => {
    const r = validatePurchaseQuantity(0.5, unit({ min_qty: 1, qty_step: 0.5 }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/minimum/i)
  })

  it('enforces max_qty', () => {
    const r = validatePurchaseQuantity(11, unit({ min_qty: 1, max_qty: 10, qty_step: 1 }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/maximum/i)
  })

  it('enforces qty_step multiples', () => {
    const r = validatePurchaseQuantity(2.3, unit({ min_qty: 0.5, qty_step: 0.5 }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/multiples/i)
  })

  it('accepts a valid fractional quantity', () => {
    expect(validatePurchaseQuantity(2.5, unit({ min_qty: 0.5, qty_step: 0.5 })).ok).toBe(true)
  })

  it('is float-tolerant at the min boundary', () => {
    expect(validatePurchaseQuantity(1, unit({ min_qty: 1, qty_step: 1 })).ok).toBe(true)
  })
})

describe('serialCountForQuantity', () => {
  it('one serial per qty_step of base quantity — measured dimension', () => {
    // Small wire: 400 m base (factor 1, length), qty_step 0.5 → 800 serials
    expect(serialCountForQuantity(400, unit({ dimension: 'length', factor: 1, qty_step: 0.5 }))).toBe(800)
    // 2.5 m, qty_step 0.5 → 5 serials
    expect(serialCountForQuantity(2.5, unit({ dimension: 'length', factor: 1, qty_step: 0.5 }))).toBe(5)
  })
  it('folds in the selling-unit factor before dividing by qty_step (count dim)', () => {
    // A box of 12, qty_step 1 → 12 serials per box
    expect(serialCountForQuantity(2, unit({ dimension: 'count', factor: 12, qty_step: 1 }))).toBe(24)
    // Earth-bit-cover shape: factor 1, step 1 → serials == qty
    expect(serialCountForQuantity(3, unit({ dimension: 'count', factor: 1, qty_step: 1 }))).toBe(3)
  })
  it('defaults to qty when unit missing (step 1)', () => {
    expect(serialCountForQuantity(4, null)).toBe(4)
  })
})

describe('validateSerializedUnitStep', () => {
  it('accepts whole-number steps', () => {
    expect(validateSerializedUnitStep(1)).toBeNull()
    expect(validateSerializedUnitStep(5)).toBeNull()
  })
  it('rejects fractional steps for serialized products', () => {
    expect(validateSerializedUnitStep(2.5)).toMatch(/whole-number qty_step/i)
    expect(validateSerializedUnitStep(0.5)).toMatch(/whole-number qty_step/i)
  })
  it('rejects zero/negative', () => {
    expect(validateSerializedUnitStep(0)).toMatch(/positive/i)
    expect(validateSerializedUnitStep(-3)).toMatch(/positive/i)
  })
})
