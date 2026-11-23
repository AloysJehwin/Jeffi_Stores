import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  getClient: vi.fn(),
}))

import {
  toSellingUnit,
  toBaseQuantity,
  isStepMultiple,
  validatePurchaseQuantity,
  serialCountForQuantity,
  serialCountForBaseQuantity,
  serialSlotsForBaseQuantity,
  validateSerializedUnitStep,
  validateUnitQuantityBounds,
  changedUnitFields,
  idPrefix,
  generateSerialNumber,
  generateLotNumber,
  generateSerialRun,
  resolveGrainUnit,
  assertUnitChangeAllowed,
  type SellingUnit,
} from '../../src/lib/selling-unit.js'

const countUnit: SellingUnit = { unit: 'box', factor: 12, dimension: 'count', qty_step: 1, min_qty: 1, max_qty: 10 }
const lenUnit: SellingUnit = { unit: 'm', factor: 1, dimension: 'length', qty_step: 0.5, min_qty: 0.5, max_qty: null }

// ── toSellingUnit ─────────────────────────────────────────────────────────
describe('toSellingUnit', () => {
  it('returns null when row is null/undefined or has no unit', () => {
    expect(toSellingUnit(null)).toBeNull()
    expect(toSellingUnit(undefined)).toBeNull()
    expect(toSellingUnit({ unit: null, factor: '2' })).toBeNull()
  })

  it('maps string numerics via num() and applies defaults', () => {
    const u = toSellingUnit({ unit: 'm', factor: '2.5', dimension: 'length', qty_step: '0.5', min_qty: '1', max_qty: '20' })
    expect(u).toEqual({ unit: 'm', factor: 2.5, dimension: 'length', qty_step: 0.5, min_qty: 1, max_qty: 20 })
  })

  it('defaults factor/qty_step to 1, dimension to count, min_qty to 0, max_qty to null', () => {
    const u = toSellingUnit({ unit: 'ea' })
    expect(u).toEqual({ unit: 'ea', factor: 1, dimension: 'count', qty_step: 1, min_qty: 0, max_qty: null })
  })

  it('coerces a zero/invalid factor and qty_step back to 1 (|| 1)', () => {
    const u = toSellingUnit({ unit: 'ea', factor: '0', qty_step: 'abc' })
    expect(u?.factor).toBe(1)
    expect(u?.qty_step).toBe(1)
  })
})

// ── toBaseQuantity ────────────────────────────────────────────────────────
describe('toBaseQuantity', () => {
  it('multiplies by factor for count dimension', () => {
    expect(toBaseQuantity(3, countUnit)).toBe(36)
  })
  it('passes through measured dimensions unchanged', () => {
    expect(toBaseQuantity(2.5, lenUnit)).toBe(2.5)
  })
  it('returns qty unchanged when unit is null', () => {
    expect(toBaseQuantity(7, null)).toBe(7)
  })
})

// ── isStepMultiple ────────────────────────────────────────────────────────
describe('isStepMultiple', () => {
  it('returns true for a positive multiple within tolerance', () => {
    expect(isStepMultiple(1.5, 0.5)).toBe(true)
  })
  it('returns false for a non-multiple', () => {
    expect(isStepMultiple(1.3, 0.5)).toBe(false)
  })
  it('returns true when step <= 0', () => {
    expect(isStepMultiple(7, 0)).toBe(true)
    expect(isStepMultiple(7, -1)).toBe(true)
  })
})

// ── validatePurchaseQuantity ──────────────────────────────────────────────
describe('validatePurchaseQuantity', () => {
  it('rejects qty <= 0 or non-finite', () => {
    expect(validatePurchaseQuantity(0, countUnit)).toEqual({ ok: false, reason: 'Quantity must be greater than zero.' })
    expect(validatePurchaseQuantity(NaN, countUnit).ok).toBe(false)
  })

  it('null unit: accepts a whole number, rejects a fraction', () => {
    expect(validatePurchaseQuantity(3, null)).toEqual({ ok: true })
    expect(validatePurchaseQuantity(2.5, null)).toEqual({ ok: false, reason: 'Quantity must be a whole number.' })
  })

  it('rejects below min_qty', () => {
    const u: SellingUnit = { ...lenUnit, min_qty: 2 }
    expect(validatePurchaseQuantity(1.5, u)).toEqual({ ok: false, reason: 'Minimum quantity is 2 m.' })
  })

  it('rejects above max_qty', () => {
    expect(validatePurchaseQuantity(11, countUnit)).toEqual({ ok: false, reason: 'Maximum quantity is 10 box.' })
  })

  it('rejects a non-step quantity', () => {
    expect(validatePurchaseQuantity(1.3, lenUnit)).toEqual({
      ok: false,
      reason: 'Quantity must be in multiples of 0.5 m.',
    })
  })

  it('accepts a valid in-bounds step multiple (no max_qty)', () => {
    expect(validatePurchaseQuantity(2.5, lenUnit)).toEqual({ ok: true })
  })
})

// ── serial counting ───────────────────────────────────────────────────────
describe('serial counting', () => {
  it('serialCountForQuantity folds factor then divides by step', () => {
    // count unit factor 12, step 1 → 3 boxes = 36 base → 36 serials
    expect(serialCountForQuantity(3, countUnit)).toBe(36)
  })
  it('serialCountForBaseQuantity divides baseQty by step (rounded)', () => {
    expect(serialCountForBaseQuantity(400, { ...lenUnit, qty_step: 0.5 })).toBe(800)
    expect(serialCountForBaseQuantity(100, null)).toBe(100) // null unit → step 1
  })
  it('serialSlotsForBaseQuantity floors and reports remainder', () => {
    expect(serialSlotsForBaseQuantity(88, { ...lenUnit, qty_step: 10 })).toEqual({
      serials: 8,
      covered: 80,
      remainder: 8,
    })
  })
  it('serialSlotsForBaseQuantity exact fit leaves no remainder', () => {
    expect(serialSlotsForBaseQuantity(100, { ...lenUnit, qty_step: 10 })).toEqual({
      serials: 10,
      covered: 100,
      remainder: 0,
    })
  })
})

// ── validateSerializedUnitStep ────────────────────────────────────────────
describe('validateSerializedUnitStep', () => {
  it('returns null for a whole-number step', () => {
    expect(validateSerializedUnitStep(1)).toBeNull()
    expect(validateSerializedUnitStep(10)).toBeNull()
  })
  it('rejects non-positive/non-finite', () => {
    expect(validateSerializedUnitStep(0)).toBe('qty_step must be a positive number.')
    expect(validateSerializedUnitStep(NaN)).toBe('qty_step must be a positive number.')
  })
  it('rejects a fractional step', () => {
    expect(validateSerializedUnitStep(2.5)).toBe(
      'Serialized products need a whole-number qty_step so each step maps to one serial.'
    )
  })
})

// ── validateUnitQuantityBounds ────────────────────────────────────────────
describe('validateUnitQuantityBounds', () => {
  it('rejects non-positive step', () => {
    expect(validateUnitQuantityBounds({ qty_step: 0, min_qty: 1 })).toBe('qty_step must be a positive number.')
  })
  it('rejects non-positive min_qty', () => {
    expect(validateUnitQuantityBounds({ qty_step: 1, min_qty: 0 })).toBe('Minimum quantity must be greater than zero.')
  })
  it('rejects min_qty below step', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 1 })).toBe(
      'Minimum quantity (1) cannot be below the quantity step (10) — the smallest orderable quantity is 10.'
    )
  })
  it('rejects min_qty not a multiple of step', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 13 })).toBe(
      'Minimum quantity (13) must be a multiple of the quantity step (10).'
    )
  })
  it('rejects max_qty below min_qty', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 20, max_qty: 10 })).toBe(
      'Maximum quantity (10) cannot be below the minimum quantity (20).'
    )
  })
  it('rejects max_qty not a multiple of step', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 10, max_qty: 25 })).toBe(
      'Maximum quantity (25) must be a multiple of the quantity step (10).'
    )
  })
  it('returns null when valid with max_qty', () => {
    expect(validateUnitQuantityBounds({ qty_step: 10, min_qty: 10, max_qty: 30 })).toBeNull()
  })
  it('returns null when valid with null max_qty', () => {
    expect(validateUnitQuantityBounds({ qty_step: 1, min_qty: 1, max_qty: null })).toBeNull()
  })
})

// ── changedUnitFields ─────────────────────────────────────────────────────
describe('changedUnitFields', () => {
  it('detects a changed numeric factor, unchanged qty_step, changed dimension', () => {
    const r = changedUnitFields(
      { factor: '5', qty_step: '1', dimension: 'weight' },
      { factor: '2', qty_step: '1', dimension: 'count' }
    )
    expect(r).toEqual({ factor: true, qtyStep: false, dimension: true })
  })
  it('treats an undefined body field as unchanged', () => {
    const r = changedUnitFields({}, { factor: '2', qty_step: '1', dimension: 'count' })
    expect(r).toEqual({ factor: false, qtyStep: false, dimension: false })
  })
  it('flags changed when current numeric is non-finite', () => {
    const r = changedUnitFields({ factor: '2' }, { factor: 'nope' })
    expect(r.factor).toBe(true)
  })
})

// ── idPrefix ──────────────────────────────────────────────────────────────
describe('idPrefix', () => {
  it('uppercases and strips non-alphanumerics, 4 chars', () => {
    expect(idPrefix('tap-123')).toBe('TAP1')
  })
  it('pads a short sku to 4 chars', () => {
    expect(idPrefix('ab')).toBe('AB00')
  })
  it('returns GEN0 for empty/absent sku', () => {
    expect(idPrefix(null)).toBe('GEN0')
    expect(idPrefix('')).toBe('GEN0')
    expect(idPrefix('---')).toBe('GEN0')
  })
})

// ── serial / lot number generation ────────────────────────────────────────
describe('generateSerialNumber / generateLotNumber', () => {
  // 2020-01-02T00:00:00Z = 1440 minutes since epoch → base36 "0" + pad = "00140"? compute:
  // 1440 in base36 = "140"; padStart(5,'0') → "00140".
  const at = new Date(Date.UTC(2020, 0, 2)) // one day after EPOCH_2020

  it('produces a deterministic 12-char id with a fixed date + seq', () => {
    const s = generateSerialNumber('TAP1', 0, at)
    // prefix(4) + stamp(5) + tail(3)
    expect(s).toBe('TAP100140000')
    expect(s).toHaveLength(12)
  })

  it('encodes the seq tail in base36 (seq 37 → "011")', () => {
    const s = generateSerialNumber('TAP1', 37, at)
    expect(s).toBe('TAP100140011')
  })

  it('generateLotNumber has the same prefix+stamp shape and 12-char width', () => {
    const l = generateLotNumber('TAP1', at)
    expect(l).toHaveLength(12)
    expect(l.slice(0, 9)).toBe('TAP100140')
  })
})

describe('generateSerialRun', () => {
  it('produces `count` unique serials', () => {
    const run = generateSerialRun('TAP1', 5)
    expect(run).toHaveLength(5)
    expect(new Set(run).size).toBe(5)
  })
  it('returns an empty array for count <= 0', () => {
    expect(generateSerialRun('TAP1', 0)).toEqual([])
    expect(generateSerialRun('TAP1', -3)).toEqual([])
  })
})

// ── resolveGrainUnit (async, mocked runner) ───────────────────────────────
describe('resolveGrainUnit', () => {
  it('maps the returned row via toSellingUnit', async () => {
    const runner = {
      query: vi.fn().mockResolvedValue({
        rows: [{ unit: 'm', factor: '2', dimension: 'length', qty_step: '0.5', min_qty: '1', max_qty: null }],
      }),
    }
    const u = await resolveGrainUnit(runner, { productId: 'p1', variantId: 'v1', subVariantId: null })
    expect(u).toEqual({ unit: 'm', factor: 2, dimension: 'length', qty_step: 0.5, min_qty: 1, max_qty: null })
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('FROM product_units'), ['p1', 'v1', null])
  })
  it('returns null when no row', async () => {
    const runner = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    expect(await resolveGrainUnit(runner, { productId: 'p1' })).toBeNull()
  })
})

// ── assertUnitChangeAllowed (async, mocked runner) ────────────────────────
describe('assertUnitChangeAllowed', () => {
  it('returns null immediately when nothing meaning-bearing changes', async () => {
    const runner = { query: vi.fn() }
    const r = await assertUnitChangeAllowed(runner, { productId: 'p1' }, { factor: false, dimension: false })
    expect(r).toBeNull()
    expect(runner.query).not.toHaveBeenCalled()
  })

  it('allows when the product is neither perishable nor serialized', async () => {
    const runner = { query: vi.fn().mockResolvedValue({ rows: [{ perishable: false, serialized: false }] }) }
    const r = await assertUnitChangeAllowed(runner, { productId: 'p1' }, { factor: true })
    expect(r).toBeNull()
    expect(runner.query).toHaveBeenCalledTimes(1)
  })

  it('refuses a serialized change while serials are in stock', async () => {
    const runner = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ perishable: false, serialized: true }] })
        .mockResolvedValueOnce({ rows: [{ n: 3 }] }),
    }
    const r = await assertUnitChangeAllowed(runner, { productId: 'p1', label: 'Wire' }, { qtyStep: true })
    expect(r).toContain('Cannot change the selling unit for "Wire"')
    expect(r).toContain('3 serial numbers are in stock')
  })

  it('serialized remove message with a single serial reads "serial number is"', async () => {
    const runner = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ perishable: false, serialized: true }] })
        .mockResolvedValueOnce({ rows: [{ n: 1 }] }),
    }
    const r = await assertUnitChangeAllowed(runner, { productId: 'p1' }, { remove: true })
    expect(r).toContain('remove the selling unit for this product')
    expect(r).toContain('1 serial number is in stock')
  })

  it('serialized but zero serials → null', async () => {
    const runner = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ perishable: false, serialized: true }] })
        .mockResolvedValueOnce({ rows: [{ n: 0 }] }),
    }
    expect(await assertUnitChangeAllowed(runner, { productId: 'p1' }, { factor: true })).toBeNull()
  })

  it('refuses a perishable dimension change while batches hold stock', async () => {
    const runner = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ perishable: true, serialized: false }] })
        .mockResolvedValueOnce({ rows: [{ n: 2 }] }),
    }
    const r = await assertUnitChangeAllowed(runner, { productId: 'p1', label: 'Milk' }, { dimension: true })
    expect(r).toContain('Cannot change the unit dimension for "Milk"')
    expect(r).toContain('2 batches still hold stock')
  })

  it('perishable factor-only change is allowed (dimension not touched)', async () => {
    const runner = { query: vi.fn().mockResolvedValueOnce({ rows: [{ perishable: true, serialized: false }] }) }
    const r = await assertUnitChangeAllowed(runner, { productId: 'p1' }, { factor: true })
    expect(r).toBeNull()
    expect(runner.query).toHaveBeenCalledTimes(1) // only the flags query
  })
})
