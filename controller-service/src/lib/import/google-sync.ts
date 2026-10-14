import * as XLSX from 'xlsx'

export type SheetMatrix = string[][]

// Accept either a bare spreadsheet id or a full Google Sheets URL and return the id, or '' if
// nothing usable is found. URL form: https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0
export function extractSpreadsheetId(input: string): string {
  const s = input.trim()
  if (!s) return ''
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9-_]+$/.test(s)) return s
  return ''
}

/**
 * Convert Google Sheets value matrices into a .xlsx Buffer that parseWorkbook accepts unchanged,
 * so the Google sync reuses the upload worker path. Pass one matrix for a legacy flat sheet, or a
 * map of tab title → matrix to rebuild the multi-sheet template with its tabs intact.
 */
export function valuesToWorkbookBuffer(values: SheetMatrix | Record<string, SheetMatrix>): Buffer {
  const sheets = Array.isArray(values) ? { Products: values } : values
  const wb = XLSX.utils.book_new()
  for (const [title, matrix] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix.length ? matrix : [[]]), title.slice(0, 31))
  }
  if (wb.SheetNames.length === 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Products')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
