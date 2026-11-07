import ExcelJS from 'exceljs'
import { readSetting, writeSettings } from '@/lib/google-ads/notify'
import type { SellableUnit } from './catalog-load'
import { normHeader, suggestColumns } from './sheet'
import type { MarketplaceChannel } from './types'

// Fills the blank category template the store downloads from the seller portal: one row per unit
// (per size), each template column taken from a catalogue field or a fixed value. The column
// mapping is saved per marketplace category, so the next export of that category is one click.

export const MAX_IMAGE_COLUMNS = 14

export const TEMPLATE_FIELDS: { key: string; label: string }[] = [
  { key: 'marketplace_sku', label: 'SKU (mapped, or yours)' },
  { key: 'our_sku', label: 'Your SKU' },
  { key: 'style_id', label: 'Style ID' },
  { key: 'name', label: 'Product name' },
  { key: 'brand', label: 'Brand' },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description' },
  { key: 'short_description', label: 'Short description' },
  { key: 'size', label: 'Size' },
  { key: 'colour', label: 'Colour' },
  { key: 'variant_name', label: 'Variant name' },
  { key: 'sub_variant_name', label: 'Sub-variant name' },
  { key: 'mrp', label: 'MRP' },
  { key: 'price', label: 'Selling price' },
  { key: 'hsn', label: 'HSN code' },
  { key: 'gst_rate', label: 'GST %' },
  { key: 'gtin', label: 'EAN / GTIN' },
  { key: 'material', label: 'Material' },
  { key: 'quantity', label: 'Stock' },
  { key: 'weight_grams', label: 'Weight (g)' },
  { key: 'length_cm', label: 'Length (cm)' },
  { key: 'breadth_cm', label: 'Breadth (cm)' },
  { key: 'height_cm', label: 'Height (cm)' },
  ...Array.from({ length: MAX_IMAGE_COLUMNS }, (_, i) => ({ key: `image_${i + 1}`, label: `Image ${i + 1} URL` })),
]
const FIELD_KEYS = new Set(TEMPLATE_FIELDS.map(f => f.key))

/** A catalogue field, a product attribute (`attr:<name>`) or a fixed value. */
export interface ColumnSource {
  field?: string
  value?: string
}

export interface TemplateMapping {
  sheet: string
  headerRow: number
  dataStartRow: number
  columns: Record<string, ColumnSource>
}

export interface TemplateSheet {
  name: string
  headerRow: number
  dataStartRow: number
  headers: string[]
}

const SYNONYMS: Record<string, string[]> = {
  marketplace_sku: ['seller sku code', 'seller sku', 'vendor sku code', 'vendor article number', 'sku code', 'sku'],
  style_id: ['style id', 'style code', 'style number'],
  name: ['product display name', 'product name', 'style name', 'product title', 'title', 'article name'],
  brand: ['brand', 'brand name'],
  description: ['product details', 'product description', 'description', 'style note'],
  size: ['standard size', 'brand size', 'size'],
  colour: ['brand colour', 'base colour', 'primary colour', 'colour', 'color'],
  mrp: ['mrp', 'maximum retail price'],
  price: ['selling price', 'seller price', 'sp', 'listing price'],
  hsn: ['hsn code', 'hsn'],
  gst_rate: ['gst rate', 'gst', 'tax rate'],
  gtin: ['ean', 'gtin', 'barcode', 'upc'],
  material: ['fabric', 'material', 'fabric type'],
  quantity: ['inventory', 'quantity', 'stock', 'qty'],
  weight_grams: ['package weight', 'weight'],
  length_cm: ['package length', 'length'],
  breadth_cm: ['package breadth', 'package width', 'breadth', 'width'],
  height_cm: ['package height', 'height'],
}

const text = (v: ExcelJS.CellValue): string => {
  if (v == null) return ''
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map(t => t.text).join('').trim()
    if ('text' in v && typeof (v as any).text === 'string') return String((v as any).text).trim()
    if ('result' in v) return String((v as any).result ?? '').trim()
    if (v instanceof Date) return v.toISOString()
  }
  return String(v).trim()
}

function rowTexts(ws: ExcelJS.Worksheet, r: number, width: number): string[] {
  const row = ws.getRow(r)
  return Array.from({ length: width }, (_, i) => text(row.getCell(i + 1).value))
}

/** The header row is the first of the top 15 with the most text cells; data starts at the first empty row after it. */
export function detectLayout(ws: ExcelJS.Worksheet): Omit<TemplateSheet, 'name'> | null {
  const width = Math.min(Math.max(ws.columnCount, 1), 300)
  let headerRow = 0
  let best = 0
  for (let r = 1; r <= Math.min(15, Math.max(ws.rowCount, 1)); r++) {
    const n = rowTexts(ws, r, width).filter(t => t && Number.isNaN(Number(t))).length
    if (n > best) {
      best = n
      headerRow = r
    }
  }
  if (best < 2) return null
  const raw = rowTexts(ws, headerRow, width)
  let last = raw.length
  while (last > 0 && !raw[last - 1]) last--
  const headers = raw.slice(0, last)
  let dataStartRow = headerRow + 1
  while (dataStartRow < headerRow + 50 && rowTexts(ws, dataStartRow, headers.length).some(Boolean)) dataStartRow++
  return { headerRow, dataStartRow, headers }
}

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buf as any)
  } catch {
    throw new Error('Could not read the template. Upload the .xlsx file exactly as the portal gave it.')
  }
  return wb
}

/** Every sheet that looks like a data sheet, with its header row and where data would start. */
export async function readTemplate(buf: Buffer): Promise<TemplateSheet[]> {
  const wb = await load(buf)
  const out: TemplateSheet[] = []
  wb.eachSheet(ws => {
    const layout = detectLayout(ws)
    if (layout) out.push({ name: ws.name, ...layout })
  })
  if (!out.length) throw new Error('No sheet in this file has a header row.')
  return out.sort((a, b) => b.headers.length - a.headers.length)
}

/** Suggested sources for template headers: synonyms, then image columns in order. */
export function suggestTemplateColumns(headers: string[], attributeKeys: string[] = []): Record<string, ColumnSource> {
  const hits = suggestColumns(headers, SYNONYMS)
  const out: Record<string, ColumnSource> = {}
  for (const [field, header] of Object.entries(hits)) if (header) out[header] = { field }
  let img = 0
  for (const h of headers) {
    if (out[h] || !/image|photo|picture/i.test(h) || img >= MAX_IMAGE_COLUMNS) continue
    out[h] = { field: `image_${++img}` }
  }
  for (const h of headers) {
    if (out[h]) continue
    const key = attributeKeys.find(k => normHeader(k) === normHeader(h))
    if (key) out[h] = { field: `attr:${key}` }
  }
  return out
}

/** The value a unit puts in a column. */
export function sourceValue(u: SellableUnit, src: ColumnSource): string | number | null {
  if (src.value != null && src.value !== '') return src.value
  const f = src.field
  if (!f) return null
  if (f.startsWith('attr:')) return u.attributes[f.slice(5)] ?? null
  const img = f.match(/^image_(\d+)$/)
  if (img) return u.images[Number(img[1]) - 1] ?? null
  switch (f) {
    case 'marketplace_sku':
      return u.listing?.marketplaceSku ?? u.ourSku
    case 'our_sku':
      return u.ourSku
    case 'style_id':
      return u.listing?.styleId ?? null
    case 'name':
      return u.name
    case 'brand':
      return u.brand
    case 'category':
      return u.listing?.category ?? u.category
    case 'description':
      return u.description ?? u.shortDescription
    case 'short_description':
      return u.shortDescription
    case 'size':
      return u.size
    case 'colour':
      return u.colour
    case 'variant_name':
      return u.variantName
    case 'sub_variant_name':
      return u.subVariantName
    case 'mrp':
      return u.mrp
    case 'price':
      return u.price
    case 'hsn':
      return u.hsn
    case 'gst_rate':
      return u.gstRate
    case 'gtin':
      return u.gtin
    case 'material':
      return u.material
    case 'quantity':
      return u.quantity == null ? null : Math.max(0, Math.floor(u.quantity))
    case 'weight_grams':
      return u.weightGrams
    case 'length_cm':
      return u.lengthCm
    case 'breadth_cm':
      return u.breadthCm
    case 'height_cm':
      return u.heightCm
    default:
      return null
  }
}

export function validMapping(m: unknown): m is TemplateMapping {
  if (!m || typeof m !== 'object') return false
  const x = m as TemplateMapping
  if (typeof x.sheet !== 'string' || !Number.isInteger(x.headerRow) || !Number.isInteger(x.dataStartRow)) return false
  if (x.headerRow < 1 || x.dataStartRow <= x.headerRow || x.dataStartRow > 1000) return false
  if (!x.columns || typeof x.columns !== 'object') return false
  return Object.values(x.columns).every(
    s => s && typeof s === 'object' && (s.value == null || typeof s.value === 'string') && (s.field == null || FIELD_KEYS.has(s.field) || /^attr:.{1,100}$/.test(s.field))
  )
}

export interface FillResult {
  buffer: Buffer
  rows: number
  /** Mapped columns that came out empty, with how many rows. */
  blanks: Record<string, number>
}

/** Writes one row per unit into the template, keeping the portal's sheet, styles and dropdowns. */
export async function fillTemplate(buf: Buffer, units: SellableUnit[], mapping: TemplateMapping): Promise<FillResult> {
  const wb = await load(buf)
  const ws = wb.getWorksheet(mapping.sheet)
  if (!ws) throw new Error(`The template has no sheet called "${mapping.sheet}".`)
  const width = Math.min(Math.max(ws.columnCount, 1), 300)
  const headers = rowTexts(ws, mapping.headerRow, width)
  const cols: { col: number; header: string; src: ColumnSource }[] = []
  for (const [header, src] of Object.entries(mapping.columns)) {
    let i = headers.indexOf(header)
    if (i < 0) i = headers.findIndex(h => normHeader(h) === normHeader(header))
    if (i >= 0 && (src.field || src.value)) cols.push({ col: i + 1, header, src })
  }
  if (!cols.length) throw new Error('None of the mapped columns are in this template. Check the header row.')
  const blanks: Record<string, number> = {}
  units.forEach((u, i) => {
    const row = ws.getRow(mapping.dataStartRow + i)
    for (const c of cols) {
      const v = sourceValue(u, c.src)
      if (v == null || v === '') blanks[c.header] = (blanks[c.header] ?? 0) + 1
      else row.getCell(c.col).value = v
    }
    row.commit()
  })
  const out = await wb.xlsx.writeBuffer()
  return { buffer: Buffer.from(out as ArrayBuffer), rows: units.length, blanks }
}

// ── Saved mappings, per marketplace category ────────────────────────────────

const settingKey = (channel: MarketplaceChannel) => `${channel}_template_maps`
const MAX_CATEGORIES = 60

export type SavedMappings = Record<string, TemplateMapping & { updatedAt: string }>

export async function savedTemplateMappings(channel: MarketplaceChannel): Promise<SavedMappings> {
  try {
    const raw = JSON.parse((await readSetting(settingKey(channel))) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

export async function saveTemplateMapping(channel: MarketplaceChannel, category: string, mapping: TemplateMapping): Promise<void> {
  const name = category.trim().slice(0, 100)
  if (!name) throw new Error('Name the marketplace category this template is for.')
  const all = await savedTemplateMappings(channel)
  all[name] = { ...mapping, updatedAt: new Date().toISOString() }
  const kept = Object.entries(all)
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
    .slice(0, MAX_CATEGORIES)
  await writeSettings({ [settingKey(channel)]: JSON.stringify(Object.fromEntries(kept)) })
}
