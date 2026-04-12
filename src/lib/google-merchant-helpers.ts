/**
 * Shared helpers for Google Merchant Center feed generation.
 * Used by both the Google Sheets feed (google-sheets.ts) and XML feed (route.ts).
 */

export function getGoogleProductCategory(product: any): string {
  return product.categories?.google_product_category
    || product.categories?.parent_google_product_category
    || ''
}

export function buildProductType(product: any): string {
  const parentName = product.categories?.parent_name
  const categoryName = product.categories?.name
  if (parentName && categoryName) return `${parentName} > ${categoryName}`
  return categoryName || ''
}

export function buildProductHighlights(product: any): string[] {
  const highlights: string[] = []
  if (product.material) highlights.push(`Made of ${product.material}`)
  if (product.finish) highlights.push(`${product.finish} finish`)
  if (product.size) highlights.push(`Size: ${product.size}`)
  if (product.weight) highlights.push(`Weight: ${product.weight} kg`)
  if (product.dimensions) highlights.push(`Dimensions: ${product.dimensions}`)
  if (product.hsn_code) highlights.push(`HSN Code: ${product.hsn_code}`)
  const brandName = product.brands?.name
  if (brandName) highlights.push(`Brand: ${brandName}`)
  return highlights.slice(0, 10)
}

export function buildProductDetails(product: any): Array<{ section: string; attribute: string; value: string }> {
  const details: Array<{ section: string; attribute: string; value: string }> = []
  if (product.weight) details.push({ section: 'Specifications', attribute: 'Weight', value: `${product.weight} kg` })
  if (product.material) details.push({ section: 'Specifications', attribute: 'Material', value: product.material })
  if (product.finish) details.push({ section: 'Specifications', attribute: 'Finish', value: product.finish })
  if (product.dimensions) details.push({ section: 'Specifications', attribute: 'Dimensions', value: product.dimensions })
  if (product.size) details.push({ section: 'Specifications', attribute: 'Size', value: product.size })
  if (product.hsn_code) details.push({ section: 'Tax', attribute: 'HSN Code', value: product.hsn_code })
  return details
}

export function buildCustomLabels(product: any, variantStockQty?: number): [string, string, string, string, string] {
  const sellingPrice = Number(product.sale_price ?? product.base_price ?? 0)

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
  const stockQty = variantStockQty ?? (product.stock_quantity ?? 0)
  let label3 = 'in-stock'
  if (stockQty === 0) label3 = 'out-of-stock'
  else if (stockQty <= (product.low_stock_threshold ?? 10)) label3 = 'low-stock'

  // custom_label_4: Featured flag
  const label4 = product.is_featured ? 'featured' : 'standard'

  return [label0, label1, label2, label3, label4]
}
