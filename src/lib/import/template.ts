import ExcelJS from 'exceljs'
import {
  ALL_COLUMNS, columnByHeader, columnsForSheet, keyColumnsFor, sheetFor,
  SHEET_ORDER, type ImportColumn, type SheetName,
} from './columns'
import { ENUMS } from './enums'

// Build the downloadable .xlsx template as a MULTI-SHEET workbook with exceljs:
//   1. "Field Guide" — read-only reference: every field, its sheet, required?, accepted values,
//      type, and help. Generated from the catalog so it can never drift from the real fields.
//   2. One sheet per level / attribute group (see SHEET_ORDER): key columns first, then a bold
//      frozen header band, a muted help row, and (on core sheets) a worked example. Enum/bool
//      columns get a list dropdown; parent-SKU columns get a cross-sheet dropdown so a product
//      added on the Products sheet appears as a choice on the Variants / attribute sheets.
//
// (The upload parser stays on `xlsx`; only this writer needs exceljs for fills, freeze panes and
// data-validation.)

const DATA_ROWS = 500
const REQUIRED_FILL = 'FFF4B183' // stronger orange — required headers
const KEY_FILL = 'FFA6A6A6'      // mid grey — link/key columns

// Header-band fill per sheet — saturated, clearly distinct hues so sheets read apart at a glance.
const SHEET_FILL: Record<SheetName, string> = {
  'Products': 'FF2E75B6',              // blue
  'Variants': 'FF548235',              // green
  'Sub-variants': 'FFBF8F00',          // amber
  'Product · Shipping': 'FF9DC3E6',    // light blue
  'Product · Compliance': 'FFA9D08E',  // light green
  'Product · SEO & Audience': 'FFF4B183', // peach
  'Product · Digital': 'FFB4A7D6',     // violet
}
// The tab colour (the coloured strip on the sheet tab), same family as the header band.
const TAB_COLOR: Record<SheetName, string> = SHEET_FILL
// Header text colour — white on the dark core sheets, near-black on the pale attribute sheets.
const DARK_HEADER = new Set<SheetName>(['Products', 'Variants', 'Sub-variants'])

function dropdownValues(col: ImportColumn): string[] | null {
  if (col.coerce === 'bool') return ENUMS.bool
  if (col.enumKey && ENUMS[col.enumKey]) return ENUMS[col.enumKey]
  return null
}

function colRef(n: number): string {
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// A column entry for a rendered sheet: either a catalog column or a synthetic key column.
interface SheetCol { header: string; help: string; required: boolean; col?: ImportColumn; isKey: boolean }

function sheetColumns(sheet: SheetName): SheetCol[] {
  const keys = keyColumnsFor(sheet).map(k => ({ header: k.header, help: k.help, required: true, isKey: true }))
  const cols = columnsForSheet(sheet).map(c => ({
    header: c.header, help: c.help || '', required: !!c.required, col: c, isKey: false,
  }))
  return [...keys, ...cols]
}

// 1-based position of a header on a sheet (for building cross-sheet dropdown ranges by letter).
function headerIndex(sheet: SheetName, header: string): number {
  return sheetColumns(sheet).findIndex(sc => sc.header === header) + 1
}
// Cross-sheet validation ranges, computed from the real column positions so a layout change can't
// silently point a dropdown at the wrong column.
const PRODUCTS_SKU_RANGE = `Products!$${colRef(headerIndex('Products', 'sku'))}$3:$${colRef(headerIndex('Products', 'sku'))}$1000`
const VARIANTS_SKU_RANGE = `Variants!$${colRef(headerIndex('Variants', 'variant.sku'))}$3:$${colRef(headerIndex('Variants', 'variant.sku'))}$1000`

export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()

  buildGuideSheet(wb)
  for (const sheet of SHEET_ORDER) buildDataSheet(wb, sheet)

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

function buildGuideSheet(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet('Field Guide', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [
    { header: 'Sheet', key: 'sheet', width: 26 },
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Required', key: 'required', width: 10 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Accepted values', key: 'accepted', width: 40 },
    { header: 'Notes', key: 'notes', width: 60 },
  ]
  const head = ws.getRow(1)
  head.font = { bold: true }
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } } })

  // Intro block above the field rows.
  ws.insertRow(1, ['How to use this workbook'])
  ws.getRow(1).font = { bold: true, size: 13 }
  ws.insertRow(2, ['Fill the Products sheet first (sku is the key). Then Variants (link each to a product by parent_sku), then Sub-variants (parent_sku + variant_sku). Attribute sheets extend a product by its sku. Removing a product row and re-syncing DELETES that product from the store (sheet-sourced products only).'])
  ws.getRow(2).font = { italic: true, color: { argb: 'FF666666' } }
  ws.getRow(2).height = 28
  ws.insertRow(3, [])

  for (const sheet of SHEET_ORDER) {
    for (const sc of sheetColumns(sheet)) {
      const accepted = sc.col ? (dropdownValues(sc.col)?.join(', ') || '') : (sc.isKey ? 'must match a SKU on the linked sheet' : '')
      const row = ws.addRow({
        sheet,
        field: sc.header,
        required: sc.required ? 'yes' : '',
        type: sc.col?.coerce || 'text',
        accepted,
        notes: sc.help,
      })
      // Colour the Sheet cell with that sheet's band so the guide reads grouped by sheet.
      row.getCell('sheet').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SHEET_FILL[sheet] } }
      if (DARK_HEADER.has(sheet)) row.getCell('sheet').font = { color: { argb: 'FFFFFFFF' } }
    }
  }
}

function buildDataSheet(wb: ExcelJS.Workbook, sheet: SheetName): void {
  const ws = wb.addWorksheet(sheet, {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { tabColor: { argb: TAB_COLOR[sheet] } },
  })
  const cols = sheetColumns(sheet)

  ws.columns = cols.map(sc => ({
    header: sc.header, key: sc.header,
    width: Math.min(Math.max(sc.header.length + 2, 12), 40),
  }))

  const headerRow = ws.getRow(1)
  const helpRow = ws.getRow(2)
  const headerText = DARK_HEADER.has(sheet) ? 'FFFFFFFF' : 'FF1F1F1F'
  cols.forEach((sc, i) => {
    const hc = headerRow.getCell(i + 1)
    hc.value = sc.header
    // Required + key columns keep their own emphatic fills; the rest carry the sheet's band colour.
    const fill = sc.required ? REQUIRED_FILL : sc.isKey ? KEY_FILL : SHEET_FILL[sheet]
    hc.font = { bold: true, color: { argb: (sc.required || sc.isKey) ? 'FF1F1F1F' : headerText } }
    hc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
    hc.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } }
    const help = helpRow.getCell(i + 1)
    help.value = sc.help
    help.font = { italic: true, size: 9, color: { argb: 'FF808080' } }
  })
  headerRow.commit()
  helpRow.commit()

  for (const row of exampleFor(sheet)) {
    ws.addRow(cols.reduce<Record<string, string>>((acc, sc) => { acc[sc.header] = row[sc.header] ?? ''; return acc }, {}))
  }

  // Data validation: enum/bool list dropdowns, and cross-sheet SKU dropdowns for key columns.
  cols.forEach((sc, i) => {
    const letter = colRef(i + 1)
    let formulae: string[] | null = null
    if (sc.isKey && (sc.header === 'parent_sku' || sc.header === 'sku')) {
      formulae = [`${PRODUCTS_SKU_RANGE}`] // validate against the Products.sku column
    } else if (sc.isKey && sc.header === 'variant_sku') {
      formulae = [`${VARIANTS_SKU_RANGE}`] // validate against the Variants.variant.sku column
    } else if (sc.col) {
      const vals = dropdownValues(sc.col)
      if (vals) formulae = [`"${vals.filter(Boolean).join(',')}"`]
    }
    if (!formulae) return
    for (let r = 3; r <= DATA_ROWS; r++) {
      ws.getCell(`${letter}${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae, showErrorMessage: false,
      }
    }
  })
}

// Worked examples, per sheet, sharing SKUs so the cross-sheet links make sense.
function exampleFor(sheet: SheetName): Record<string, string>[] {
  switch (sheet) {
    case 'Products':
      return [{ sku: 'TSHIRT-001', name: 'Cotton T-Shirt', category: 'Apparel', brand: 'Acme', base_price: '499', mrp: '699', gst_percentage: '5', has_variants: 'TRUE', variant_type: 'Color', image_urls: 'https://example.com/front.jpg|https://example.com/back.jpg' }]
    case 'Variants':
      return [
        { parent_sku: 'TSHIRT-001', 'variant.sku': 'TSHIRT-001-RED', 'variant.variant_name': 'Red', 'variant.price': '499', 'variant.image_urls': 'https://example.com/red-1.jpg|https://example.com/red-2.jpg', 'variant.sub_variant_type_on': 'TRUE' },
        { parent_sku: 'TSHIRT-001', 'variant.sku': 'TSHIRT-001-BLU', 'variant.variant_name': 'Blue', 'variant.price': '499', 'variant.image_urls': 'https://example.com/blue-1.jpg', 'variant.inventory_quantity': '30', 'variant.stock_status': 'In Stock' },
      ]
    case 'Sub-variants':
      return [
        { parent_sku: 'TSHIRT-001', variant_sku: 'TSHIRT-001-RED', 'sub_variant.sub_variant_name': 'Red / M', 'sub_variant.sku': 'TSHIRT-001-RED-M', 'sub_variant.price': '499', 'sub_variant.stock_status': 'In Stock' },
        { parent_sku: 'TSHIRT-001', variant_sku: 'TSHIRT-001-RED', 'sub_variant.sub_variant_name': 'Red / L', 'sub_variant.sku': 'TSHIRT-001-RED-L', 'sub_variant.price': '499', 'sub_variant.stock_status': 'In Stock' },
      ]
    case 'Product · Shipping':
      return [{ sku: 'TSHIRT-001', weight_grams: '200', length_cm: '25', breadth_cm: '20', height_cm: '2', fragile: 'FALSE' }]
    default:
      return [{ sku: 'TSHIRT-001' }]
  }
}

// Header used by the parser to detect the help row on an uploaded file.
export const TEMPLATE_HELP_MARKER = columnByHeader('row_type')?.help || 'product | variant | sub_variant'

export { ALL_COLUMNS }
