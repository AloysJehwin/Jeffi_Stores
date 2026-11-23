import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  normUnit,
  toSellingUnit,
  serialCountForQuantity,
  serialSlotsForBaseQuantity,
  assertUnitChangeAllowed,
  generateSerialNumber,
  generateLotNumber,
  idPrefix,
  type SellingUnit,
} from '@/lib/catalog/selling-unit'

// This file ADDS coverage the existing tests/lib/selling-unit.test.ts misses:
// normUnit synonyms, the perishable+serialized combined path, label-safe id
// determinism/edge cases, and a few branch corners.

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

afterEach(() => vi.restoreAllMocks())

describe('normUnit', () => {
  it('canonicalises synonyms and strips a trailing dot', () => {
    expect(normUnit('Boxes')).toBe('box')
    expect(normUnit('nos')).toBe('pc')
    expect(normUnit('pcs.')).toBe('pc')
    expect(normUnit(' Metres ')).toBe('m')
    expect(normUnit('DZ')).toBe('dozen')
  })
  it('passes an unknown word through lowercased', () => {
    expect(normUnit('widget')).toBe('widget')
  })
  it('handles null/undefined as empty', () => {
    expect(normUnit(null)).toBe('')
    expect(normUnit(undefined)).toBe('')
  })
})

describe('toSellingUnit — fallback corners', () => {
  it('defaults dimension to count and min_qty to 0', () => {
    const u = toSellingUnit({ unit: 'box' })!
    expect(u.dimension).toBe('count')
    expect(u.min_qty).toBe(0)
    expect(u.max_qty).toBeNull()
  })
  it('keeps an explicit max_qty and parses string numerics', () => {
    const u = toSellingUnit({ unit: 'box', max_qty: '50' })!
    expect(u.max_qty).toBe(50)
  })
  it('falls back factor/step to 1 on non-numeric input', () => {
    const u = toSellingUnit({ unit: 'm', factor: 'abc', qty_step: 'xyz' })!
    expect(u.factor).toBe(1)
    expect(u.qty_step).toBe(1)
  })
})

describe('serialCountForQuantity rounding', () => {
  it('rounds to the nearest whole serial', () => {
    // base 7 / step 2 = 3.5 → round → 4
    const u = { unit: 'm', factor: 1, dimension: 'length', qty_step: 2, min_qty: 2, max_qty: null } as SellingUnit
    expect(serialCountForQuantity(7, u)).toBe(4)
  })
})

describe('serialSlotsForBaseQuantity — missing/zero step', () => {
  it('treats a null unit as step 1', () => {
    expect(serialSlotsForBaseQuantity(5, null)).toEqual({ serials: 5, covered: 5, remainder: 0 })
  })
  it('treats a zero/negative qty_step as step 1', () => {
    const u = { unit: 'x', factor: 1, dimension: 'count', qty_step: 0, min_qty: 0, max_qty: null } as SellingUnit
    expect(serialSlotsForBaseQuantity(3, u)).toEqual({ serials: 3, covered: 3, remainder: 0 })
  })
})

describe('assertUnitChangeAllowed — serialized AND perishable', () => {
  it('blocks the dimension change on the batch path after serials pass clean', async () => {
    // serialized+perishable, no serials, but batches hold stock → dimension refused.
    const r = runner([{ perishable: true, serialized: true }], [{ n: 0 }], [{ n: 3 }])
    const err = await assertUnitChangeAllowed(r, SCOPE, { dimension: true })
    expect(err).toMatch(/3 batches/i)
    expect(r.calls).toHaveLength(3) // flags, serials, batches
  })

  it('does not query batches when only the factor changes on a perishable product', async () => {
    const r = runner([{ perishable: true, serialized: false }])
    expect(await assertUnitChangeAllowed(r, SCOPE, { factor: true })).toBeNull()
    expect(r.calls).toHaveLength(1) // only the flags read
  })

  it('uses singular wording for exactly one serial', async () => {
    const r = runner([{ perishable: false, serialized: true }], [{ n: 1 }])
    const err = await assertUnitChangeAllowed(r, SCOPE, { remove: true })
    expect(err).toMatch(/1 serial number is in stock/i)
    expect(err).toMatch(/remove the selling unit/i)
  })

  it('uses "this product" when no label is given', async () => {
    const r = runner([{ perishable: false, serialized: true }], [{ n: 2 }])
    const err = await assertUnitChangeAllowed(r, { productId: 'p1' }, { factor: true })
    expect(err).toMatch(/for this product/i)
    expect(err).toMatch(/change the selling unit/i)
  })

  it('uses singular wording for exactly one batch', async () => {
    const r = runner([{ perishable: true, serialized: false }], [{ n: 1 }])
    const err = await assertUnitChangeAllowed(r, SCOPE, { dimension: true })
    expect(err).toMatch(/1 batch /i)
  })

  it('treats missing flag rows as untracked', async () => {
    const r = runner([]) // no products row
    expect(await assertUnitChangeAllowed(r, SCOPE, { factor: true })).toBeNull()
  })
})

describe('label-safe ids — determinism & edges', () => {
  it('is deterministic for a fixed date + seq', () => {
    const at = new Date(Date.UTC(2024, 5, 1, 12, 0, 0))
    expect(generateSerialNumber('TAP-HTJ15', 1, at)).toBe(generateSerialNumber('TAP-HTJ15', 1, at))
  })
  it('a date before the 2020 epoch floors the stamp to zeros', () => {
    const at = new Date(Date.UTC(2010, 0, 1))
    const id = generateSerialNumber('AB', 0, at)
    expect(id.slice(4, 9)).toBe('00000')
    expect(id).toHaveLength(12)
  })
  it('generateLotNumber yields a 12-char label-safe id', () => {
    expect(generateLotNumber('x')).toMatch(/^[A-Z0-9]{12}$/)
  })
  it('idPrefix returns GEN0 for punctuation-only skus', () => {
    expect(idPrefix('---')).toBe('GEN0')
    expect(idPrefix(undefined)).toBe('GEN0')
  })
  it('a random tail (no seq) is still 12 chars and label-safe', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(generateSerialNumber('TAP')).toMatch(/^[A-Z0-9]{12}$/)
  })
})
