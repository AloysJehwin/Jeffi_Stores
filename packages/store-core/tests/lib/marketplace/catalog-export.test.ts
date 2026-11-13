import { describe, it, expect, vi } from 'vitest'
import ExcelJS from 'exceljs'

vi.mock('@/lib/google-ads/notify', () => ({ readSetting: vi.fn(async () => null), writeSettings: vi.fn(async () => {}) }))

import { fillTemplate, readTemplate, sourceValue, suggestTemplateColumns, validMapping, type TemplateMapping } from '@/lib/marketplace/catalog-export'
import type { SellableUnit } from '@/lib/marketplace/catalog-load'

const HEADERS = ['Vendor SKU Code', 'Style Name', 'Brand', 'Brand Size', 'Brand Colour', 'MRP', 'Selling Price', 'HSN', 'Fabric', 'Front Image', 'Back Image', 'Neck', 'Country of Origin']

// Shaped like a portal category template: a title row, the header row, a mandatory/optional row,
// a size dropdown on the data rows, and a second instructions sheet.
async function template(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const info = wb.addWorksheet('Instructions')
  info.getCell('A1').value = 'Fill one row per size'
  const ws = wb.addWorksheet('Tshirts')
  ws.getCell('A1').value = 'Myntra listing template - Tshirts'
  ws.getRow(2).values = HEADERS
  ws.getRow(2).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
  ws.getRow(3).values = HEADERS.map((_, i) => (i < 6 ? 'Mandatory' : 'Optional'))
  for (let r = 4; r <= 20; r++) ws.getCell(`D${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"S,M,L,XL"'] }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer)
}

function unit(over: Partial<SellableUnit> = {}): SellableUnit {
  return {
    key: 'p1:v1:s1',
    level: 'sub_variant',
    productId: 'p1',
    variantId: 'v1',
    subVariantId: 's1',
    name: 'Crew Tee',
    variantName: 'Red',
    subVariantName: 'M',
    ourSku: 'TEE-RED-M',
    size: 'M',
    colour: 'Red',
    brand: 'Test Brand',
    category: 'Tshirts',
    description: 'Soft cotton tee',
    shortDescription: null,
    material: 'Cotton',
    hsn: '6109',
    gstRate: 5,
    gtin: null,
    price: 499,
    mrp: 799,
    quantity: 12.7,
    stockStatus: 'In Stock',
    weightGrams: 200,
    lengthCm: null,
    breadthCm: null,
    heightCm: null,
    attributes: { Neck: 'Round' },
    images: ['https://img.test/front.jpg'],
    listing: null,
    ...over,
  }
}

describe('readTemplate', () => {
  it('finds the header row and the first empty row after the instructions', async () => {
    const sheets = await readTemplate(await template())
    expect(sheets[0]).toMatchObject({ name: 'Tshirts', headerRow: 2, dataStartRow: 4 })
    expect(sheets[0].headers).toEqual(HEADERS)
    expect(sheets.map(s => s.name)).not.toContain('Instructions')
  })

  it('refuses a file that is not a workbook', async () => {
    await expect(readTemplate(Buffer.from('not a spreadsheet'))).rejects.toThrow(/Could not read the template/)
  })
})

describe('suggestTemplateColumns', () => {
  it('maps catalogue fields by synonym, image columns in order, and matching attributes', () => {
    const s = suggestTemplateColumns(HEADERS, ['Neck'])
    expect(s['Vendor SKU Code']).toEqual({ field: 'marketplace_sku' })
    expect(s['Style Name']).toEqual({ field: 'name' })
    expect(s['Brand']).toEqual({ field: 'brand' })
    expect(s['Brand Size']).toEqual({ field: 'size' })
    expect(s['Brand Colour']).toEqual({ field: 'colour' })
    expect(s['MRP']).toEqual({ field: 'mrp' })
    expect(s['Selling Price']).toEqual({ field: 'price' })
    expect(s['Fabric']).toEqual({ field: 'material' })
    expect(s['Front Image']).toEqual({ field: 'image_1' })
    expect(s['Back Image']).toEqual({ field: 'image_2' })
    expect(s['Neck']).toEqual({ field: 'attr:Neck' })
    expect(s['Country of Origin']).toEqual({ field: 'country_of_origin' })
  })
})

describe('sourceValue', () => {
  it('uses the mapped marketplace SKU, falling back to ours', () => {
    expect(sourceValue(unit(), { field: 'marketplace_sku' })).toBe('TEE-RED-M')
    const mapped = unit({ listing: { id: 'l1', marketplaceSku: 'MYN-123', styleId: '9001', status: 'mapped', issues: [], category: null, listingRef: null, listedPrice: null, listedMrp: null, lastTaskId: null, syncedAt: null } })
    expect(sourceValue(mapped, { field: 'marketplace_sku' })).toBe('MYN-123')
    expect(sourceValue(mapped, { field: 'style_id' })).toBe('9001')
  })

  it('floors quantity, reads attributes and images, and prefers a fixed value', () => {
    expect(sourceValue(unit(), { field: 'quantity' })).toBe(12)
    expect(sourceValue(unit({ quantity: -3 }), { field: 'quantity' })).toBe(0)
    expect(sourceValue(unit(), { field: 'attr:Neck' })).toBe('Round')
    expect(sourceValue(unit(), { field: 'image_2' })).toBeNull()
    expect(sourceValue(unit(), { field: 'brand', value: 'India' })).toBe('India')
  })
})

describe('validMapping', () => {
  const ok: TemplateMapping = { sheet: 'Tshirts', headerRow: 2, dataStartRow: 4, columns: { MRP: { field: 'mrp' }, Neck: { field: 'attr:Neck' }, 'Country of Origin': { value: 'India' } } }
  it('accepts catalogue fields, attributes and fixed values', () => {
    expect(validMapping(ok)).toBe(true)
  })
  it('rejects unknown fields and data rows above the header', () => {
    expect(validMapping({ ...ok, columns: { MRP: { field: 'password' } } })).toBe(false)
    expect(validMapping({ ...ok, dataStartRow: 2 })).toBe(false)
    expect(validMapping(null)).toBe(false)
  })
})

describe('fillTemplate', () => {
  it('writes one row per unit from the first data row and keeps the portal formatting', async () => {
    const mapping: TemplateMapping = {
      sheet: 'Tshirts',
      headerRow: 2,
      dataStartRow: 4,
      columns: { ...suggestTemplateColumns(HEADERS, ['Neck']), 'Country of Origin': { value: 'India' } },
    }
    const units = [unit(), unit({ key: 'p1:v1:s2', subVariantId: 's2', ourSku: 'TEE-RED-L', size: 'L', images: [], attributes: {} })]
    const out = await fillTemplate(await template(), units, mapping)
    expect(out.rows).toBe(2)
    expect(out.blanks).toEqual({ 'Front Image': 1, 'Back Image': 2, Neck: 1 })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(out.buffer as any)
    const ws = wb.getWorksheet('Tshirts')!
    expect(ws.getRow(3).getCell(1).value).toBe('Mandatory')
    const r4 = ws.getRow(4)
    expect([1, 2, 4, 5, 6, 7, 8, 12, 13].map(c => r4.getCell(c).value)).toEqual(['TEE-RED-M', 'Crew Tee', 'M', 'Red', 799, 499, '6109', 'Round', 'India'])
    expect(r4.getCell(10).value).toBe('https://img.test/front.jpg')
    expect(ws.getRow(5).getCell(1).value).toBe('TEE-RED-L')
    expect(ws.getRow(5).getCell(4).value).toBe('L')
    expect((ws.getRow(2).getCell(1).fill as any)?.fgColor?.argb).toBe('FFFFFF00')
    expect(ws.getCell('D5').dataValidation?.type).toBe('list')
  })

  it('refuses a mapping whose sheet is missing or matches no column', async () => {
    const buf = await template()
    await expect(fillTemplate(buf, [unit()], { sheet: 'Shirts', headerRow: 2, dataStartRow: 4, columns: { MRP: { field: 'mrp' } } })).rejects.toThrow(/no sheet/)
    await expect(fillTemplate(buf, [unit()], { sheet: 'Tshirts', headerRow: 2, dataStartRow: 4, columns: { Price: { field: 'price' } } })).rejects.toThrow(/None of the mapped columns/)
  })
})
