import ExcelJS from 'exceljs'
import { ALL_COLUMNS, HEADER_ROW, columnByHeader, type ImportColumn } from './columns'
import { ENUMS } from './enums'

// Build the downloadable .xlsx template with exceljs: a bold, frozen header band colored
// by section, a muted help row, and a small worked example. Enum/bool columns carry a
// list dropdown so the sheet offers exactly what the product form does. Returns a Buffer.
//
// (The upload parser stays on `xlsx` — only this writer needs exceljs, for fills, freeze
// panes, and data-validation, which the community `xlsx` build cannot emit.)

const DATA_ROWS = 500 // rows 3..DATA_ROWS get dropdowns applied

const REQUIRED_FILL = 'FFF8CBAD' // red-tint — required headers
const SECTION_FILL: Record<string, string> = {
  structure: 'FFD9D9D9', // grey
  product: 'FFBDD7EE',   // blue
  variant: 'FFC6E0B4',   // green
  sub_variant: 'FFFFE699', // amber
}

function sectionOf(col: ImportColumn): keyof typeof SECTION_FILL {
  if (col.header.startsWith('variant.')) return 'variant'
  if (col.header.startsWith('sub_variant.')) return 'sub_variant'
  if (col.rowTypes.length === 1 && col.rowTypes[0] === 'product') return 'product'
  if (STRUCTURE_HEADERS.has(col.header)) return 'structure'
  return 'product'
}

const STRUCTURE_HEADERS = new Set(['row_type', 'parent_sku', 'variant_sku', 'image_urls'])

function dropdownValues(col: ImportColumn): string[] | null {
  if (col.coerce === 'bool') return ENUMS.bool
  if (col.enumKey && ENUMS[col.enumKey]) return ENUMS[col.enumKey]
  return null
}

export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Products', {
    views: [{ state: 'frozen', ySplit: 2 }],
  })

  ws.columns = HEADER_ROW.map(h => ({
    header: h,
    key: h,
    width: Math.min(Math.max(h.length + 2, 12), 40),
  }))

  const headerRow = ws.getRow(1)
  const helpRow = ws.getRow(2)

  ALL_COLUMNS.forEach((col, i) => {
    const c = i + 1
    const hCell = headerRow.getCell(c)
    hCell.value = col.header
    hCell.font = { bold: true }
    hCell.alignment = { vertical: 'middle', horizontal: 'left' }
    const fill = col.required ? REQUIRED_FILL : SECTION_FILL[sectionOf(col)]
    hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
    hCell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } }

    const helpCell = helpRow.getCell(c)
    helpCell.value = col.help || ''
    helpCell.font = { italic: true, size: 9, color: { argb: 'FF808080' } }
  })
  headerRow.commit()
  helpRow.commit()

  for (const e of example()) {
    ws.addRow(HEADER_ROW.reduce<Record<string, string>>((acc, h) => { acc[h] = e[h] ?? ''; return acc }, {}))
  }

  ALL_COLUMNS.forEach((col, i) => {
    const values = dropdownValues(col)
    if (!values) return
    const colLetter = colRef(i + 1)
    for (let r = 3; r <= DATA_ROWS; r++) {
      ws.getCell(`${colLetter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${values.filter(Boolean).join(',')}"`],
        showErrorMessage: false, // advisory only — do not hard-block out-of-list values
      }
    }
  })

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

function colRef(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function example(): Record<string, string>[] {
  return [
    { row_type: 'product', sku: 'TSHIRT-001', name: 'Cotton T-Shirt', category: 'Apparel', brand: 'Acme', base_price: '499', mrp: '699', gst_percentage: '5', discount_pct: '10', has_variants: 'TRUE', variant_type: 'Color', image_urls: 'https://example.com/tshirt-front.jpg|https://example.com/tshirt-back.jpg' },
    { row_type: 'variant', parent_sku: 'TSHIRT-001', 'variant.sku': 'TSHIRT-001-RED', 'variant.variant_name': 'Red', 'variant.price': '499', 'variant.sub_variant_type_on': 'TRUE' },
    { row_type: 'sub_variant', parent_sku: 'TSHIRT-001', variant_sku: 'TSHIRT-001-RED', 'sub_variant.sub_variant_name': 'Red / M', 'sub_variant.sku': 'TSHIRT-001-RED-M', 'sub_variant.price': '499', 'sub_variant.stock_status': 'In Stock' },
    { row_type: 'sub_variant', parent_sku: 'TSHIRT-001', variant_sku: 'TSHIRT-001-RED', 'sub_variant.sub_variant_name': 'Red / L', 'sub_variant.sku': 'TSHIRT-001-RED-L', 'sub_variant.price': '499', 'sub_variant.stock_status': 'In Stock' },
    { row_type: 'variant', parent_sku: 'TSHIRT-001', 'variant.sku': 'TSHIRT-001-BLU', 'variant.variant_name': 'Blue', 'variant.price': '499', 'variant.inventory_quantity': '30', 'variant.stock_status': 'In Stock' },
  ]
}

// Header labels used by the parser to detect the help/example rows in an uploaded
// file (so we can skip the help row without treating it as data).
export const TEMPLATE_HELP_MARKER = columnByHeader('row_type')?.help || 'product | variant | sub_variant'

export { ALL_COLUMNS }
