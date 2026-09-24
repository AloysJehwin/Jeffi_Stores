import * as XLSX from 'xlsx'
import {
  HEADER_ROW, columnByHeader, columnsForSheet, keyColumnsFor, ALL_COLUMNS, ATTRIBUTE_SHEETS,
  type RowType, type SheetName,
} from './columns'
import { coerceCell, parseImageUrls } from './coerce'

export interface ParsedRow {
  rowNumber: number            // 1-based spreadsheet row (for error reporting)
  sheet?: string               // worksheet the row came from (multi-sheet template only)
  rowType: RowType
  parentSku: string | null
  variantSku: string | null
  imageUrls: string[]
  values: Record<string, unknown>   // coerced, section-agnostic: keyed by column.key
  errors: string[]                  // per-cell coercion errors
}

export interface ParseResult {
  rows: ParsedRow[]
  fatal?: string   // whole-file problem (bad headers, empty, unreadable)
}

const MAX_ROWS = 5000
const STRUCTURE_KEYS = new Set(['row_type', 'parent_sku', 'variant_sku', 'image_urls'])

type Cell = (header: string) => unknown

/**
 * Parse an uploaded workbook/CSV buffer into structured rows. Two layouts are accepted:
 *  - the multi-sheet template (a Products tab plus Variants / Sub-variants / attribute tabs,
 *    each keyed by SKU) — the layout the downloadable template and the Google "create sheet
 *    from template" flow both produce;
 *  - the legacy flat grid (one sheet, a row_type column deciding each row's level).
 * Coercion errors are captured per-row, not thrown — a bad cell is a row error, not a file failure.
 */
export function parseWorkbook(buf: Buffer): ParseResult {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'buffer' })
  } catch {
    return { rows: [], fatal: 'Could not read the file — is it a valid .xlsx or .csv?' }
  }
  if (!wb.SheetNames.length) return { rows: [], fatal: 'The workbook has no sheets.' }

  const products = wb.Sheets['Products']
  if (products) {
    const { headers } = readSheet(products)
    if (!headers.includes('row_type')) return parseTemplate(wb)
    return parseFlat(products)
  }
  return parseFlat(wb.Sheets[wb.SheetNames[0]])
}

function readSheet(ws: XLSX.WorkSheet): { headers: string[]; aoa: unknown[][] } {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null })
  const headers = ((aoa[0] as unknown[]) || []).map(h => String(h ?? '').trim())
  return { headers, aoa }
}

const cellReader = (headers: string[], raw: unknown[]): Cell => (header) => {
  const idx = headers.indexOf(header)
  return idx === -1 ? null : raw[idx]
}

function isBlank(raw: unknown[]): boolean {
  return raw.every(v => v === null || v === undefined || String(v).trim() === '')
}

// The template ships a help row under every header. Recognise it by content, not position, so a
// sheet whose help row was deleted (or duplicated) still parses.
function isHelpRow(headers: string[], raw: unknown[], helpOf: Map<string, string>): boolean {
  let filled = 0, matched = 0
  headers.forEach((h, i) => {
    const v = String(raw[i] ?? '').trim()
    if (!v) return
    filled++
    const help = helpOf.get(h)
    if (help && v === help) matched++
  })
  return filled > 0 && matched * 2 >= filled
}

function helpLookup(sheet: SheetName): Map<string, string> {
  const m = new Map<string, string>()
  for (const k of keyColumnsFor(sheet)) m.set(k.header, k.help)
  for (const c of columnsForSheet(sheet)) if (c.help) m.set(c.header, c.help)
  return m
}

function coerceRow(sheet: SheetName, rowType: RowType, cell: Cell): { values: Record<string, unknown>; errors: string[] } {
  const values: Record<string, unknown> = {}
  const errors: string[] = []
  for (const col of columnsForSheet(sheet)) {
    if (STRUCTURE_KEYS.has(col.key) || !col.rowTypes.includes(rowType)) continue
    const r = coerceCell(cell(col.header), col.coerce)
    if (r.error) errors.push(`${col.header}: ${r.error}`)
    else if (r.value !== undefined) values[col.key] = r.value
  }
  return { values, errors }
}

function parseTemplate(wb: XLSX.WorkBook): ParseResult {
  const rows: ParsedRow[] = []
  const productBySku = new Map<string, ParsedRow>()

  const eachRow = (sheet: SheetName, fn: (rowNumber: number, cell: Cell) => void) => {
    const ws = wb.Sheets[sheet]
    if (!ws) return
    const { headers, aoa } = readSheet(ws)
    if (!headers.some(Boolean)) return
    const helpOf = helpLookup(sheet)
    for (let i = 1; i < aoa.length; i++) {
      const raw = aoa[i] as unknown[]
      if (isBlank(raw) || isHelpRow(headers, raw, helpOf)) continue
      fn(i + 1, cellReader(headers, raw))
    }
  }

  eachRow('Products', (rowNumber, cell) => {
    const { values, errors } = coerceRow('Products', 'product', cell)
    const row: ParsedRow = {
      rowNumber, sheet: 'Products', rowType: 'product', parentSku: null, variantSku: null,
      imageUrls: parseImageUrls(cell('image_urls')), values, errors,
    }
    rows.push(row)
    const sku = str(cell('sku'))
    if (sku && !productBySku.has(sku)) productBySku.set(sku, row)
  })

  for (const sheet of ATTRIBUTE_SHEETS) {
    eachRow(sheet, (rowNumber, cell) => {
      const sku = str(cell('sku'))
      const { values, errors } = coerceRow(sheet, 'product', cell)
      if (!sku) {
        rows.push({ rowNumber, sheet, rowType: 'product', parentSku: null, variantSku: null, imageUrls: [], values: {}, errors: [`${sheet}: row has values but no sku`] })
        return
      }
      const target = productBySku.get(sku)
      if (!target) {
        rows.push({ rowNumber, sheet, rowType: 'product', parentSku: null, variantSku: null, imageUrls: [], values: { sku }, errors: [`${sheet}: sku "${sku}" is not on the Products sheet`] })
        return
      }
      Object.assign(target.values, values)
      for (const e of errors) target.errors.push(`${sheet}: ${e}`)
    })
  }

  eachRow('Variants', (rowNumber, cell) => {
    const { values, errors } = coerceRow('Variants', 'variant', cell)
    rows.push({ rowNumber, sheet: 'Variants', rowType: 'variant', parentSku: str(cell('parent_sku')), variantSku: null, imageUrls: [], values, errors })
  })

  eachRow('Sub-variants', (rowNumber, cell) => {
    const { values, errors } = coerceRow('Sub-variants', 'sub_variant', cell)
    rows.push({ rowNumber, sheet: 'Sub-variants', rowType: 'sub_variant', parentSku: str(cell('parent_sku')), variantSku: str(cell('variant_sku')), imageUrls: [], values, errors })
  })

  if (rows.length === 0) return { rows: [], fatal: 'No data rows found under the headers. Fill the Products sheet first.' }
  if (rows.length > MAX_ROWS) return { rows: rows.slice(0, MAX_ROWS), fatal: `Too many rows (max ${MAX_ROWS}). Split the file.` }
  return { rows }
}

function parseFlat(ws: XLSX.WorkSheet): ParseResult {
  const { headers, aoa } = readSheet(ws)
  if (aoa.length === 0) return { rows: [], fatal: 'The sheet is empty.' }

  const known = headers.filter(h => columnByHeader(h))
  if (!known.includes('row_type')) {
    return { rows: [], fatal: 'Missing the "row_type" column — download and use the template.' }
  }

  const rows: ParsedRow[] = []
  for (let i = 1; i < aoa.length; i++) {
    if (rows.length >= MAX_ROWS) return { rows, fatal: `Too many rows (max ${MAX_ROWS}). Split the file.` }
    const raw = aoa[i] as unknown[]
    const cell = cellReader(headers, raw)

    const rowTypeRaw = String(cell('row_type') ?? '').trim().toLowerCase()
    // Skip the template's help row (its row_type cell carries the help text).
    if (!rowTypeRaw || rowTypeRaw.includes('|')) continue
    if (rowTypeRaw !== 'product' && rowTypeRaw !== 'variant' && rowTypeRaw !== 'sub_variant') {
      rows.push({
        rowNumber: i + 1, rowType: 'product', parentSku: null, variantSku: null,
        imageUrls: [], values: {},
        errors: [`invalid row_type "${rowTypeRaw}" (expected product | variant | sub_variant)`],
      })
      continue
    }
    const rowType = rowTypeRaw as RowType

    const values: Record<string, unknown> = {}
    const errors: string[] = []
    for (const col of ALL_COLUMNS) {
      if (STRUCTURE_KEYS.has(col.key)) continue
      if (!col.rowTypes.includes(rowType)) continue
      const r = coerceCell(cell(col.header), col.coerce)
      if (r.error) errors.push(`${col.header}: ${r.error}`)
      else if (r.value !== undefined) values[col.key] = r.value
    }

    rows.push({
      rowNumber: i + 1,
      rowType,
      parentSku: str(cell('parent_sku')),
      variantSku: str(cell('variant_sku')),
      imageUrls: parseImageUrls(cell('image_urls')),
      values,
      errors,
    })
  }

  if (rows.length === 0) return { rows: [], fatal: 'No data rows found under the header.' }
  return { rows }
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export { HEADER_ROW }
