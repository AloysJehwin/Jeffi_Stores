import { describe, it, expect } from 'vitest'
import {
  toSellingUnit,
  toBaseQuantity,
  isStepMultiple,
  validatePurchaseQuantity,
  serialCountForQuantity,
  validateSerializedUnitStep,
  assertUnitChangeAllowed,
  changedUnitFields,
  resolveGrainUnit,
  generateSerialNumber,
  generateLotNumber,
  generateSerialRun,
  idPrefix,
  type SellingUnit,
  serialCountForBaseQuantity,
  serialSlotsForBaseQuantity,
  validateUnitQuantityBounds,
} from '@/lib/catalog/selling-unit'

function unit(over: Partial<SellingUnit> = {}): SellingUnit {
  return { unit: 'm', factor: 1, dimension: 'length', qty_step: 0.5, min_qty: 0.5, max_qty: null, ...over }
}

describe('toSellingUnit', () => {
  it('returns null when there is no unit', () => {
    expect(toSellingUnit(null)).toBeNull()
    expect(toSellingUnit({ unit: null })).toBeNull()
  })

  it('coerces string numerics from pg and defaults factor/step', () => {
    const u = toSellingUnit({
      unit: 'box',
      factor: '12',
      dimension: 'count',
      qty_step: '1',
      min_qty: '1',
      max_qty: null,
    })
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

/** Runner stub: answers each query in the order the guard issues them. */
function runner(...responses: any[][]) {
  let i = 0
  const calls: { sql: string; params: any[] }[] = []
  return {
    calls,
    query: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params })
      return { rows: responses[i++] ?? [] }
    },
  }
}

const SCOPE = { productId: 'p1', label: 'box' }

describe('changedUnitFields', () => {
  it('reports nothing when the body re-sends identical values', () => {
    const c = changedUnitFields(
      { factor: 12, dimension: 'count', qty_step: 1 },
      { factor: '12', dimension: 'count', qty_step: '1' }
    )
    expect(c).toEqual({ factor: false, qtyStep: false, dimension: false })
  })
  it('ignores fields the body omits', () => {
    const c = changedUnitFields({}, { factor: '12', dimension: 'count', qty_step: '1' })
    expect(c).toEqual({ factor: false, qtyStep: false, dimension: false })
  })
  it('detects a real change in each field', () => {
    expect(changedUnitFields({ factor: 6 }, { factor: '12' }).factor).toBe(true)
    expect(changedUnitFields({ qty_step: 2 }, { qty_step: '1' }).qtyStep).toBe(true)
    expect(changedUnitFields({ dimension: 'length' }, { dimension: 'count' }).dimension).toBe(true)
  })
})

describe('assertUnitChangeAllowed', () => {
  it('allows anything on an untracked product', async () => {
    const r = runner([{ perishable: false, serialized: false }])
    expect(await assertUnitChangeAllowed(r, SCOPE, { factor: true, dimension: true, qtyStep: true })).toBeNull()
  })

  it('is a no-op when nothing meaning-bearing changes', async () => {
    const r = runner()
    expect(await assertUnitChangeAllowed(r, SCOPE, { factor: false, dimension: false, qtyStep: false })).toBeNull()
    expect(r.calls).toHaveLength(0) // never even reads the flags
  })

  it('blocks factor, qty_step, dimension and delete while serials are in stock', async () => {
    for (const change of [{ factor: true }, { qtyStep: true }, { dimension: true }, { remove: true }]) {
      const r = runner([{ perishable: false, serialized: true }], [{ n: 42 }])
      const err = await assertUnitChangeAllowed(r, SCOPE, change)
      expect(err).toMatch(/42 serial numbers are in stock/i)
    }
  })

  it('allows the change on a serialized product with no serials left', async () => {
    const r = runner([{ perishable: false, serialized: true }], [{ n: 0 }])
    expect(await assertUnitChangeAllowed(r, SCOPE, { factor: true })).toBeNull()
  })

  it('allows factor and qty_step on a perishable product with batches', async () => {
    // Batches hold BASE units, so a factor change only alters what a future sale
    // consumes — existing lots stay correct.
    const r = runner([{ perishable: true, serialized: false }])
    expect(await assertUnitChangeAllowed(r, SCOPE, { factor: true, qtyStep: true })).toBeNull()
  })

  it('blocks a dimension change while batches hold stock', async () => {
    const r = runner([{ perishable: true, serialized: false }], [{ n: 2 }])
    const err = await assertUnitChangeAllowed(r, SCOPE, { dimension: true })
    expect(err).toMatch(/dimension/i)
    expect(err).toMatch(/2 batches/i)
  })

  it('allows a dimension change once the batches are empty', async () => {
    const r = runner([{ perishable: true, serialized: false }], [{ n: 0 }])
    expect(await assertUnitChangeAllowed(r, SCOPE, { dimension: true })).toBeNull()
  })

  it('scopes the serial count to the grain being edited', async () => {
    const r = runner([{ perishable: false, serialized: true }], [{ n: 0 }])
    await assertUnitChangeAllowed(r, { productId: 'p1', variantId: 'v1', subVariantId: 'sv1' }, { factor: true })
    expect(r.calls[1].params).toEqual(['p1', 'v1', 'sv1'])
  })
})

describe('resolveGrainUnit', () => {
  it('asks for the base unit most-specific-first', async () => {
    const r = runner([{ unit: 'm', factor: '1', dimension: 'length', qty_step: '0.5', min_qty: '0.5', max_qty: null }])
    const u = await resolveGrainUnit(r, { productId: 'p1', variantId: 'v1', subVariantId: 'sv1' })
    expect(u?.unit).toBe('m')
    expect(u?.qty_step).toBe(0.5)
    expect(r.calls[0].sql).toMatch(/ORDER BY sub_variant_id NULLS LAST, variant_id NULLS LAST/)
    expect(r.calls[0].params).toEqual(['p1', 'v1', 'sv1'])
  })
  it('returns null when the grain has no base unit', async () => {
    const r = runner([])
    expect(await resolveGrainUnit(r, { productId: 'p1' })).toBeNull()
  })
})

describe('label-safe identifiers', () => {
  it('produces exactly 12 characters, prefix + body', () => {
    expect(generateSerialNumber('TAP-HTJ15')).toHaveLength(12)
    expect(generateLotNumber('TAP-HTJ15')).toHaveLength(12)
    expect(generateSerialNumber('TAP-HTJ15').startsWith('TAPH')).toBe(true)
  })
  it('stays 12 chars for short, missing and messy SKUs', () => {
    for (const sku of ['AB', '', null, undefined, 'x', 'a-b/c d']) {
      expect(generateSerialNumber(sku as any)).toHaveLength(12)
      expect(generateLotNumber(sku as any)).toHaveLength(12)
    }
  })
  it('uses only label-safe characters', () => {
    expect(generateSerialNumber('TAP-HTJ15')).toMatch(/^[A-Z0-9]{12}$/)
    expect(generateLotNumber('TAP-HTJ15')).toMatch(/^[A-Z0-9]{12}$/)
  })
  it('generates a collision-free run — random tails cannot guarantee this', () => {
    const run = generateSerialRun('TAP-HTJ15', 2000)
    expect(run).toHaveLength(2000)
    expect(new Set(run).size).toBe(2000)
    run.forEach(id => expect(id).toHaveLength(12))
  })
  it('returns an empty run for a non-positive count', () => {
    expect(generateSerialRun('X', 0)).toEqual([])
    expect(generateSerialRun('X', -5)).toEqual([])
  })
  it('idPrefix pads and truncates to 4', () => {
    expect(idPrefix('TAP-HTJ15')).toBe('TAPH')
    expect(idPrefix('AB')).toBe('AB00')
    expect(idPrefix(null)).toBe('GEN0')
  })
})

describe('serialCountForBaseQuantity', () => {
  it('divides a BASE quantity by qty_step without re-applying factor', () => {
    const unit = { unit: 'm', factor: 1, dimension: 'length', qty_step: 10, min_qty: 10, max_qty: null } as any
    expect(serialCountForBaseQuantity(100, unit)).toBe(10)
  })

  it('treats a missing unit as step 1', () => {
    expect(serialCountForBaseQuantity(7, null)).toBe(7)
  })

  it('handles a fractional step', () => {
    const unit = { unit: 'm', factor: 1, dimension: 'length', qty_step: 0.5, min_qty: 0.5, max_qty: null } as any
    expect(serialCountForBaseQuantity(400, unit)).toBe(800)
  })
})

describe('serialSlotsForBaseQuantity', () => {
  const step10 = { unit: 'm', factor: 1, dimension: 'length', qty_step: 10, min_qty: 10, max_qty: null } as any

  it('floors to whole slots and reports the remainder', () => {
    // The 88-with-step-10 case: 8 labels cover 80, 8 units written off.
    expect(serialSlotsForBaseQuantity(88, step10)).toEqual({ serials: 8, covered: 80, remainder: 8 })
  })

  it('leaves no remainder on an exact multiple', () => {
    expect(serialSlotsForBaseQuantity(80, step10)).toEqual({ serials: 8, covered: 80, remainder: 0 })
  })

  it('yields zero slots below one step', () => {
    expect(serialSlotsForBaseQuantity(4, step10)).toEqual({ serials: 0, covered: 0, remainder: 4 })
  })

  it('does not lose a slot to float error', () => {
    const step = { unit: 'kg', factor: 1, dimension: 'weight', qty_step: 0.1, min_qty: 0.1, max_qty: null } as any
    expect(serialSlotsForBaseQuantity(0.3, step).serials).toBe(3)
  })
})

describe('validateUnitQuantityBounds', () => {
  it('accepts min/max that sit on the step grid', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 10, max_qty: 100 })).toBeNull()
  })

  it('rejects a minimum below the step', () => {
    // min 1 with step 10 advertises a minimum nobody can order.
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 1, max_qty: 100 })).toMatch(
      /cannot be below the quantity step/i
    )
  })

  it('rejects a minimum that is not a multiple of the step', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 13, max_qty: 100 })).toMatch(
      /must be a multiple of the quantity step/i
    )
  })

  it('rejects a maximum that is not a multiple of the step', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 10, max_qty: 95 })).toMatch(
      /Maximum quantity .* must be a multiple/i
    )
  })

  it('rejects a maximum below the minimum', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 50, max_qty: 20 })).toMatch(
      /cannot be below the minimum/i
    )
  })

  it('allows a null maximum', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 20, max_qty: null })).toBeNull()
  })

  it('is a no-op for step 1', () => {
    expect(validateUnitQuantityBounds({ qty_step: 1, min_qty: 1, max_qty: 7 })).toBeNull()
  })

  it('handles a fractional step on the grid', () => {
    expect(validateUnitQuantityBounds({ qty_step: 0.5, min_qty: 1.5, max_qty: 10 })).toBeNull()
    expect(validateUnitQuantityBounds({ qty_step: 0.5, min_qty: 1.3, max_qty: 10 })).toMatch(
      /multiple of the quantity step/i
    )
  })
})
