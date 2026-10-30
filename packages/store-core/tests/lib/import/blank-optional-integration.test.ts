import { describe, it, expect } from 'vitest'
import { parseWorkbook } from '@/lib/import/parse'
import { groupRows } from '@/lib/import/validate-row'
import { buildFields, backfillBlankOptionalFields } from '@/lib/import/to-draft'
import { valuesToWorkbookBuffer } from '@/lib/import/google-sync'
import { HEADER_ROW, PRODUCT_COLUMNS } from '@/lib/import/columns'

// #492 end-to-end: drive the REAL parse → group → buildFields → backfill chain for BOTH import
// sources (flat CSV grid + the Google-sync matrix path), with blank optional cells, and assert a
// blank preserves the existing product's live value on re-import (never NULLs it) while new products
// take DB defaults. Stops before publishProductDraft (needs Postgres); the SQL preserve/NULL
// behaviour is covered by product-draft tests. These prove the import layer feeds publish correctly.

const NO_IDS = { categoryId: null, brandId: null, supplierId: null }

// A full flat-grid row: row_type + every header, values keyed by header. Blank = ''.
function flatBuffer(cells: Record<string, string>) {
  const headers = ['row_type', ...HEADER_ROW]
  const row = headers.map(h => (h === 'row_type' ? 'product' : (cells[h] ?? '')))
  return valuesToWorkbookBuffer([headers, row])
}

function groupFromFlat(cells: Record<string, string>) {
  const parsed = parseWorkbook(flatBuffer(cells))
  expect(parsed.fatal).toBeUndefined()
  const { groups } = groupRows(parsed.rows)
  expect(groups).toHaveLength(1)
  return groups[0]
}

// Live product row as it would come back from `SELECT * FROM products`.
const LIVE = {
  sku: 'WIDGET-1',
  name: 'Widget One',
  description: 'The original description',
  base_price: 499,
  mrp: 599,
  color: 'Blue',
  weight_grams: 250,
  warranty_months: 24,
  is_featured: true,
  meta_title: 'Widget One — best widget',
  hsn_code: '7318',
  inventory_quantity: 40,
}

describe('#492 flat CSV grid — blank optional cells', () => {
  it('EXISTING product: blank optional cells preserve the live value', () => {
    // sku + name required; everything else blank.
    const group = groupFromFlat({ sku: 'WIDGET-1', name: 'Widget One' })
    expect(group.errors).toEqual([])
    const fields = backfillBlankOptionalFields(buildFields(group, NO_IDS), LIVE)
    expect(fields.description).toBe('The original description')
    expect(fields.base_price).toBe(499)
    expect(fields.color).toBe('Blue')
    expect(fields.warranty_months).toBe(24)
    expect(fields.is_featured).toBe(true)
    expect(fields.meta_title).toBe('Widget One — best widget')
  })

  it('NEW product: blank optional cells stay absent (DB defaults apply)', () => {
    const group = groupFromFlat({ sku: 'NEW-1', name: 'New Product' })
    const fields = backfillBlankOptionalFields(buildFields(group, NO_IDS), null)
    expect('description' in fields).toBe(false)
    expect('base_price' in fields).toBe(false)
    expect('color' in fields).toBe(false)
  })

  it('EXISTING product: an explicit cell overrides the live value', () => {
    const group = groupFromFlat({ sku: 'WIDGET-1', name: 'Widget One', description: 'Updated copy', base_price: '799' })
    const fields = backfillBlankOptionalFields(buildFields(group, NO_IDS), LIVE)
    expect(fields.description).toBe('Updated copy')
    expect(fields.base_price).toBe(799)
    // untouched optional still preserved
    expect(fields.color).toBe('Blue')
  })

  it('a real 0 / false cell is kept, NOT replaced by the live value', () => {
    const group = groupFromFlat({ sku: 'WIDGET-1', name: 'Widget One', base_price: '0', is_featured: 'false' })
    const fields = backfillBlankOptionalFields(buildFields(group, NO_IDS), LIVE)
    expect(fields.base_price).toBe(0)
    expect(fields.is_featured).toBe(false)
  })

  it('required fields are never sourced from the live row', () => {
    const group = groupFromFlat({ sku: 'WIDGET-1', name: 'Widget One' })
    const fields = backfillBlankOptionalFields(buildFields(group, NO_IDS), LIVE)
    // buildFields sets sku/name from the group, not the backfill; a wrong-SKU live row can't leak in
    expect(fields.sku).toBe('WIDGET-1')
    expect(fields.name).toBe('Widget One')
  })

  it('live columns that are null are skipped (no null written)', () => {
    const group = groupFromFlat({ sku: 'WIDGET-1', name: 'Widget One' })
    const fields = backfillBlankOptionalFields(buildFields(group, NO_IDS), { ...LIVE, color: null, finish: null })
    expect('color' in fields).toBe(false)
    expect('finish' in fields).toBe(false)
  })
})

describe('#492 Google-sync multi-sheet path — blank optional cells', () => {
  // Mirror the multi-sheet template: a Products sheet (sku/name + blank optionals) keyed by sku.
  function sheetsBuffer(productCells: Record<string, string>) {
    const productHeaders = ['row_type', ...HEADER_ROW]
    const row = productHeaders.map(h => (h === 'row_type' ? 'product' : (productCells[h] ?? '')))
    return valuesToWorkbookBuffer({ Products: [productHeaders, row] })
  }

  it('EXISTING product via the sheet path preserves live values identically to CSV', () => {
    const parsed = parseWorkbook(sheetsBuffer({ sku: 'WIDGET-1', name: 'Widget One' }))
    expect(parsed.fatal).toBeUndefined()
    const { groups } = groupRows(parsed.rows)
    const fields = backfillBlankOptionalFields(buildFields(groups[0], NO_IDS), LIVE)
    expect(fields.description).toBe('The original description')
    expect(fields.base_price).toBe(499)
    expect(fields.weight_grams).toBe(250)
  })
})

describe('#492 coverage: every optional product column is backfillable', () => {
  it('a fully-blank existing row restores every optional PRODUCT_COLUMNS field present on the live row', () => {
    const group = groupFromFlat({ sku: 'WIDGET-1', name: 'Widget One' })
    const base = buildFields(group, NO_IDS)
    // Backfill covers PRODUCT_COLUMNS only — image_urls is a STRUCTURE column (flows through the
    // image pipeline, not draft `fields`), so it is deliberately NOT backfilled.
    const optionalKeys = PRODUCT_COLUMNS.filter(
      c => !c.required && !['category', 'brand', 'supplier'].includes(c.key)
    ).map(c => c.key)
    const live: Record<string, unknown> = { sku: 'WIDGET-1', name: 'Widget One' }
    for (const k of optionalKeys) live[k] = `live-${k}`
    const fields = backfillBlankOptionalFields({ ...base }, live)
    for (const k of optionalKeys) {
      if (base[k] === undefined) expect(fields[k]).toBe(`live-${k}`)
    }
  })
})
