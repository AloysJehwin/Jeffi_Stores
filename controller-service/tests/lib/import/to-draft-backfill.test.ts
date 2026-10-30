import { describe, it, expect } from 'vitest'
import { backfillBlankOptionalFields } from '@controller/lib/import/to-draft'
import { coerceCell } from '@/lib/import/coerce'

// #492: a blank optional cell is coerced to undefined (so parse.ts omits its key) — identical for
// Google Sheets and CSV, which both run through coerceCell. For an EXISTING product the engine then
// backfills the omitted optional keys from the live row, so a blank cell preserves the current value
// instead of letting the shared publish SQL NULL it out. New products keep the DB column defaults.

describe('coerceCell blank → undefined (both import sources omit the key)', () => {
  for (const c of ['text', 'number', 'int', 'bool', 'date', 'csv', 'json'] as const) {
    it(`${c}: blank cell yields undefined, no error`, () => {
      expect(coerceCell('', c)).toEqual({ value: undefined })
      expect(coerceCell(null, c)).toEqual({ value: undefined })
      expect(coerceCell('   ', c)).toEqual({ value: undefined })
    })
  }
})

describe('backfillBlankOptionalFields', () => {
  const live = {
    description: 'Live description',
    base_price: 199,
    weight_grams: 500,
    color: 'Blue',
    inventory_quantity: 12,
    sku: 'LIVE-SKU',
    name: 'Live Name',
    category_id: 'cat-live',
  }

  it('fills optional keys omitted by a blank cell from the live row', () => {
    const fields: Record<string, unknown> = { sku: 'X', name: 'X' } // only required present
    backfillBlankOptionalFields(fields, live)
    expect(fields.description).toBe('Live description')
    expect(fields.base_price).toBe(199)
    expect(fields.weight_grams).toBe(500)
  })

  it('does NOT override a value the row explicitly provided', () => {
    const fields: Record<string, unknown> = { sku: 'X', name: 'X', base_price: 250, color: 'Red' }
    backfillBlankOptionalFields(fields, live)
    expect(fields.base_price).toBe(250)
    expect(fields.color).toBe('Red')
  })

  it('never backfills required or engine-resolved ref keys', () => {
    const fields: Record<string, unknown> = {}
    backfillBlankOptionalFields(fields, live)
    expect(fields.sku).toBeUndefined() // required, set elsewhere by the engine
    expect(fields.name).toBeUndefined()
    expect(fields.category).toBeUndefined() // resolved to category_id by the engine
  })

  it('leaves a new product (null live row) untouched — takes DB defaults', () => {
    const fields: Record<string, unknown> = { sku: 'X', name: 'X' }
    const before = { ...fields }
    backfillBlankOptionalFields(fields, null)
    expect(fields).toEqual(before)
  })

  it('skips live columns that are null/undefined', () => {
    const fields: Record<string, unknown> = {}
    backfillBlankOptionalFields(fields, { description: null, color: undefined, finish: 'Matte' } as any)
    expect('description' in fields).toBe(false)
    expect('color' in fields).toBe(false)
    expect(fields.finish).toBe('Matte')
  })
})
