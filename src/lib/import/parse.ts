import * as XLSX from 'xlsx'
import { HEADER_ROW, columnByHeader, ALL_COLUMNS } from './columns'
import { coerceCell, parseImageUrls } from './coerce'
import type { RowType } from './columns'

export interface ParsedRow {
  rowNumber: number            // 1-based spreadsheet row (for error reporting)
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

// Parse an uploaded workbook/CSV buffer into structured rows. Detects and skips the
// help row (template ships one under the header). Coercion errors are captured
// per-row, not thrown — a bad cell is a row error, not a file failure.
export function parseWorkbook(buf: Buffer): ParseResult {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'buffer' })
  } catch {
    return { rows: [], fatal: 'Could not read the file — is it a valid .xlsx or .csv?' }
  }
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { rows: [], fatal: 'The workbook has no sheets.' }
  const ws = wb.Sheets[sheetName]

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null })
  if (aoa.length === 0) return { rows: [], fatal: 'The sheet is empty.' }

  const headers = (aoa[0] as unknown[]).map(h => String(h ?? '').trim())
  const known = headers.filter(h => columnByHeader(h))
  if (!known.includes('row_type')) {
    return { rows: [], fatal: 'Missing the "row_type" column — download and use the template.' }
  }

  const rows: ParsedRow[] = []
  for (let i = 1; i < aoa.length; i++) {
    if (rows.length >= MAX_ROWS) return { rows, fatal: `Too many rows (max ${MAX_ROWS}). Split the file.` }
    const raw = aoa[i] as unknown[]
    const cell = (header: string) => {
      const idx = headers.indexOf(header)
      return idx === -1 ? null : raw[idx]
    }

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
      if (col.key === 'row_type' || col.key === 'parent_sku' || col.key === 'variant_sku' || col.key === 'image_urls') continue
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
