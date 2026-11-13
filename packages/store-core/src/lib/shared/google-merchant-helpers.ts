/**
 * Shared helpers for Google Merchant Center feed generation.
 * Used by both the Google Sheets feed (google-sheets.ts) and XML feed (route.ts).
 */

import { humanizeLabel } from '@/lib/shared/format'
import { specValues } from '@/lib/catalog/product-specs'

export function getGoogleProductCategory(product: any): string {
  return product.categories?.google_product_category || product.categories?.parent_google_product_category || ''
}

export function buildProductType(product: any): string {
  const parentName = product.categories?.parent_name
  const categoryName = product.categories?.name
  if (parentName && categoryName) return `${parentName} > ${categoryName}`
  return categoryName || ''
}

const str = (v: unknown) => (v == null ? '' : String(v).trim())
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const oneLine = (v: unknown) => str(v).replace(/\s*\n+\s*/g, ', ')

/** "Pack of 10" / "500 ml" style quantity line, if the product declares one. */
function netQuantity(p: any): string {
  const n = Number(p.net_quantity)
  return n > 0 ? `${n} ${str(p.net_quantity_unit)}`.trim() : ''
}

function warranty(p: any): string {
  const m = Number(p.warranty_months)
  if (!(m > 0)) return ''
  const span = m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} month${m === 1 ? '' : 's'}`
  return `${span}${str(p.warranty_type) ? ` ${str(p.warranty_type).replace(/_/g, ' ')}` : ''} warranty`
}

export function buildProductHighlights(product: any): string[] {
  const highlights: string[] = []
  // AI-approved features read best as bullets (Amazon takes the first five).
  for (const f of (Array.isArray(product.ai_features) ? product.ai_features : []).slice(0, 5)) {
    if (str(f)) highlights.push(cap(str(f)).slice(0, 150))
  }
  if (product.material) highlights.push(`Made of ${product.material}`)
  if (product.finish) highlights.push(`${product.finish} finish`)
  if (product.size) highlights.push(`Size: ${product.size}`)
  if (product.weight) highlights.push(`Weight: ${product.weight} kg`)
  if (product.dimensions) highlights.push(`Dimensions: ${product.dimensions}`)
  if (product.hsn_code) highlights.push(`HSN Code: ${product.hsn_code}`)
  const brandName = product.brands?.name
  if (brandName) highlights.push(`Brand: ${brandName}`)
  if (str(product.pack_size)) highlights.push(`Pack size: ${str(product.pack_size)}`)
  if (warranty(product)) highlights.push(cap(warranty(product)))
  if (str(product.in_the_box)) highlights.push(`In the box: ${oneLine(product.in_the_box)}`.slice(0, 150))
  return highlights.slice(0, 10)
}

export function buildProductDetails(product: any): Array<{ section: string; attribute: string; value: string }> {
  const details: Array<{ section: string; attribute: string; value: string }> = []
  const add = (section: string, attribute: string, value: unknown) => {
    const v = str(value)
    if (v) details.push({ section, attribute, value: v.slice(0, 750) })
  }
  if (product.weight) details.push({ section: 'Specifications', attribute: 'Weight', value: `${product.weight} kg` })
  if (product.material) details.push({ section: 'Specifications', attribute: 'Material', value: product.material })
  if (product.finish) details.push({ section: 'Specifications', attribute: 'Finish', value: product.finish })
  if (product.dimensions)
    details.push({ section: 'Specifications', attribute: 'Dimensions', value: product.dimensions })
  if (product.size) details.push({ section: 'Specifications', attribute: 'Size', value: product.size })
  if (product.hsn_code) details.push({ section: 'Tax', attribute: 'HSN Code', value: product.hsn_code })
  add('General', 'Model number', product.model_number)
  add('General', 'Series', product.series)
  add('General', 'Colour', product.color)
  add('General', 'Pack size', product.pack_size)
  add('General', 'Net quantity', netQuantity(product))
  add('General', 'Country of origin', product.country_of_origin)
  add('General', 'Warranty', warranty(product))
  if (Array.isArray(product.certifications)) add('General', 'Certifications', product.certifications.filter(Boolean).join(', '))
  add('In the box', 'Contents', oneLine(product.in_the_box))
  add('Usage', 'How to use', product.usage_instructions)
  add('Usage', 'Care', product.care_instructions)
  add('Usage', 'Safety', product.safety_warnings)
  add('Manufacturer', 'Manufacturer', product.manufacturer_name)
  add('Manufacturer', 'Importer', product.importer_name)
  add('Manufacturer', 'Packer', product.packer_name)
  const spec = product.specifications
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const have = new Set(details.map(d => d.attribute.toLowerCase()))
    for (const [k, v] of Object.entries(spec).slice(0, 40)) {
      const label = humanizeLabel(k)
      const value = specValues(v).join(', ')
      if (!value || have.has(label.toLowerCase())) continue
      add('Specifications', label.slice(0, 140), value)
    }
  }
  return details
}

export function buildCustomLabels(product: any, variantStockStatus?: string): [string, string, string, string, string] {
  const sellingPrice = Number(product.base_price ?? 0)

  // custom_label_0: Category name
  const label0 = product.categories?.name || ''

  // custom_label_1: Price range bucket
  let label1 = ''
  if (sellingPrice < 100) label1 = 'under-100'
  else if (sellingPrice < 500) label1 = '100-500'
  else if (sellingPrice < 2000) label1 = '500-2000'
  else if (sellingPrice < 10000) label1 = '2000-10000'
  else label1 = 'above-10000'

  // custom_label_2: Brand or "unbranded"
  const label2 = product.brands?.name || 'unbranded'

  // custom_label_3: Stock status
  const status = variantStockStatus ?? product.stock_status ?? 'In Stock'
  let label3 = 'in-stock'
  if (status === 'Out of Stock') label3 = 'out-of-stock'
  else if (status === 'Low Stock') label3 = 'low-stock'

  // custom_label_4: Featured flag
  const label4 = product.is_featured ? 'featured' : 'standard'

  return [label0, label1, label2, label3, label4]
}
