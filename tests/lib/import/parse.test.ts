import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildTemplateWorkbook } from '@/lib/import/template'
import { parseWorkbook } from '@/lib/import/parse'
import { groupRows } from '@/lib/import/validate-row'
import { valuesToWorkbookBuffer } from '@/lib/import/google-sync'
import { SHEET_ORDER } from '@/lib/import/columns'

function sheetsOf(buf: Buffer): Record<string, string[][]> {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const out: Record<string, string[][]> = {}
  for (const name of wb.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: '',
    }) as string[][]
  }
  return out
}

describe('multi-sheet template', () => {
  it('has no duplicated headers on any tab and keeps the example rows aligned', async () => {
    const sheets = sheetsOf(await buildTemplateWorkbook())
    for (const tab of SHEET_ORDER) {
      const headers = sheets[tab][0]
      expect(new Set(headers).size).toBe(headers.length)
    }
    const sub = sheets['Sub-variants']
    expect(sub[0].slice(0, 3)).toEqual(['parent_sku', 'variant_sku', 'sub_variant.sku'])
    expect(sub[2].slice(0, 3)).toEqual(['TSHIRT-001', 'TSHIRT-001-RED', 'TSHIRT-001-RED-M'])
  })

  it('parses the downloadable template itself: help rows skipped, attribute tabs merged by sku', async () => {
    const parsed = parseWorkbook(await buildTemplateWorkbook())
    expect(parsed.fatal).toBeUndefined()
    expect(parsed.rows.map(r => `${r.sheet}:${r.rowType}`)).toEqual([
      'Products:product',
      'Variants:variant',
      'Variants:variant',
      'Sub-variants:sub_variant',
      'Sub-variants:sub_variant',
    ])
    const { groups, orphans } = groupRows(parsed.rows)
    expect(orphans).toEqual([])
    expect(groups).toHaveLength(1)
    const p = groups[0]
    expect(p.sku).toBe('TSHIRT-001')
    expect(p.errors).toEqual([])
    expect(p.imageUrls).toHaveLength(2)
    expect(p.values.weight_grams).toBe(200)
    expect(p.values.fragile).toBe(false)
    expect(p.variants.map(v => [v.sku, v.subVariants.length])).toEqual([
      ['TSHIRT-001-RED', 2],
      ['TSHIRT-001-BLU', 0],
    ])
  })

  it('parses the same content when it arrives as per-tab value matrices (the Google Sheet path)', async () => {
    const sheets = sheetsOf(await buildTemplateWorkbook())
    delete sheets['Field Guide']
    const parsed = parseWorkbook(valuesToWorkbookBuffer(sheets))
    expect(parsed.fatal).toBeUndefined()
    expect(parsed.rows).toHaveLength(5)
    expect(groupRows(parsed.rows).groups[0].values.length_cm).toBe(25)
  })

  it('flags an attribute row whose sku is not on the Products tab, and a row with no sku', () => {
    const buf = valuesToWorkbookBuffer({
      Products: [
        ['sku', 'name', 'category', 'brand', 'base_price'],
        ['A1', 'Thing', 'Cat', 'Brand', '10'],
      ],
      'Product · Shipping': [
        ['sku', 'weight_grams'],
        ['A1', '500'],
        ['NOPE', '5'],
        ['', '7'],
      ],
    })
    const parsed = parseWorkbook(buf)
    expect(parsed.fatal).toBeUndefined()
    const product = parsed.rows.find(r => r.values.sku === 'A1' && r.sheet === 'Products')!
    expect(product.values.weight_grams).toBe(500)
    const bad = parsed.rows.filter(r => r.sheet === 'Product · Shipping')
    expect(bad).toHaveLength(2)
    expect(bad[0].errors[0]).toContain('"NOPE" is not on the Products sheet')
    expect(bad[1].errors[0]).toContain('no sku')
  })

  it('works without the help row and ignores blank rows', () => {
    const buf = valuesToWorkbookBuffer({
      Products: [
        ['sku', 'name', 'category', 'brand', 'base_price'],
        ['', '', '', '', ''],
        ['B2', 'Bee', 'Cat', 'Brand', '20'],
      ],
      Variants: [
        ['parent_sku', 'variant.sku', 'variant.variant_name', 'variant.price'],
        ['B2', 'B2-S', 'Small', '20'],
      ],
    })
    const parsed = parseWorkbook(buf)
    expect(parsed.rows.map(r => r.rowType)).toEqual(['product', 'variant'])
    expect(parsed.rows[1].parentSku).toBe('B2')
    expect(parsed.rows[1].values.sku).toBe('B2-S')
  })

  it('reports a template with nothing filled in as fatal', () => {
    const buf = valuesToWorkbookBuffer({ Products: [['sku', 'name']], Variants: [['parent_sku', 'variant.sku']] })
    expect(parseWorkbook(buf).fatal).toMatch(/No data rows/)
  })
})

describe('legacy flat layout', () => {
  it('still parses a single sheet driven by row_type', () => {
    const buf = valuesToWorkbookBuffer([
      [
        'row_type',
        'sku',
        'name',
        'category',
        'brand',
        'base_price',
        'parent_sku',
        'variant.sku',
        'variant.variant_name',
      ],
      ['product | variant | sub_variant', '', '', '', '', '', '', '', ''],
      ['product', 'X1', 'Thing', 'Cat', 'Brand', '10', '', '', ''],
      ['variant', '', '', '', '', '', 'X1', 'X1-R', 'Red'],
    ])
    const parsed = parseWorkbook(buf)
    expect(parsed.fatal).toBeUndefined()
    expect(parsed.rows.map(r => r.rowType)).toEqual(['product', 'variant'])
    expect(parsed.rows[0].sheet).toBeUndefined()
    expect(groupRows(parsed.rows).groups[0].variants[0].sku).toBe('X1-R')
  })

  it('rejects a flat sheet without row_type', () => {
    const buf = valuesToWorkbookBuffer({
      Sheet1: [
        ['sku', 'name'],
        ['X', 'Y'],
      ],
    })
    expect(parseWorkbook(buf).fatal).toMatch(/row_type/)
  })
})
