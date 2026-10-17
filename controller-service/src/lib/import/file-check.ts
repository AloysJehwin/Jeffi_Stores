export const IMPORT_MAX_BYTES = 15 * 1024 * 1024
export const IMPORT_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const

const ZIP = [0x50, 0x4b, 0x03, 0x04] // .xlsx
const OLE = [0xd0, 0xcf, 0x11, 0xe0] // .xls

const startsWith = (buf: Buffer, sig: number[]) => sig.every((b, i) => buf[i] === b)

/** Server-side gate for an import upload: size, extension, and that the bytes match the extension. */
export function checkImportFile(name: string, buf: Buffer): { status: number; error: string } | null {
  if (buf.length === 0) return { status: 400, error: 'The file is empty.' }
  if (buf.length > IMPORT_MAX_BYTES) {
    return { status: 413, error: 'File is larger than 15 MB. Split it into smaller files.' }
  }
  const ext = (name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '') as (typeof IMPORT_EXTENSIONS)[number]
  if (!IMPORT_EXTENSIONS.includes(ext)) {
    return { status: 415, error: 'Unsupported file type. Upload a .xlsx, .xls or .csv file.' }
  }
  if (ext === '.xlsx' && !startsWith(buf, ZIP)) {
    return { status: 415, error: 'This is not a valid .xlsx file. Save it from Excel or Google Sheets as .xlsx.' }
  }
  if (ext === '.xls' && !startsWith(buf, OLE) && !startsWith(buf, ZIP)) {
    return { status: 415, error: 'This is not a valid .xls file. Save it as .xlsx or .csv and try again.' }
  }
  if (ext === '.csv') {
    const head = buf.subarray(0, 4096)
    if (startsWith(buf, ZIP) || startsWith(buf, OLE) || head.includes(0)) {
      return { status: 415, error: 'This file is not plain-text CSV. Upload it with its real extension (.xlsx).' }
    }
  }
  return null
}
