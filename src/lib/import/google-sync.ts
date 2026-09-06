import * as XLSX from 'xlsx'

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

// Convert a Google Sheets value matrix (rows of strings, first row = headers) into a .xlsx Buffer
// that parseWorkbook accepts unchanged — so the Google sync reuses the existing upload worker path.
export function valuesToWorkbookBuffer(values: string[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(values)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Products')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
