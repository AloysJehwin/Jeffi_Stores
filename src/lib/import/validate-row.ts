import type { ParsedRow } from './parse'

const rowRef = (r: ParsedRow) => (r.sheet ? `${r.sheet} row ${r.rowNumber}` : `row ${r.rowNumber}`)

export interface VariantGroup {
  sku: string
  values: Record<string, unknown>
  rowNumber: number
  subVariants: { values: Record<string, unknown>; rowNumber: number }[]
}

export interface ProductGroup {
  sku: string
  name: string
  values: Record<string, unknown>
  imageUrls: string[]
  rowNumber: number
  variants: VariantGroup[]
  errors: string[]
}

export interface GroupResult {
  groups: ProductGroup[]
  orphans: { rowNumber: number; message: string }[]
}

// Fold flat parsed rows into product groups. A `product` row opens a group; following
// `variant`/`sub_variant` rows attach to it by parent_sku / variant_sku. Structural
// problems (a variant with no product, an unknown parent, missing required fields,
// duplicate SKUs within the file) are captured as per-row/per-group errors — the good
// groups still import (locked: per-row errors, not all-or-nothing).
export function groupRows(rows: ParsedRow[]): GroupResult {
  const groups: ProductGroup[] = []
  const orphans: { rowNumber: number; message: string }[] = []
  const byProductSku = new Map<string, ProductGroup>()

  for (const row of rows) {
    if (row.rowType === 'product') {
      const sku = String(row.values.sku ?? '').trim()
      const name = String(row.values.name ?? '').trim()
      const errors = [...row.errors]
      if (!sku) errors.push('product row is missing sku')
      if (!name) errors.push('product row is missing name')
      const group: ProductGroup = {
        sku, name, values: row.values, imageUrls: row.imageUrls,
        rowNumber: row.rowNumber, variants: [], errors,
      }
      if (sku && byProductSku.has(sku)) {
        group.errors.push(`duplicate product sku "${sku}" in file (also row ${byProductSku.get(sku)!.rowNumber})`)
      } else if (sku) {
        byProductSku.set(sku, group)
      }
      groups.push(group)
    }
  }

  for (const row of rows) {
    if (row.rowType === 'variant') {
      const parent = row.parentSku && byProductSku.get(row.parentSku)
      if (!parent) {
        orphans.push({ rowNumber: row.rowNumber, message: `variant references unknown parent_sku "${row.parentSku ?? ''}"` })
        continue
      }
      const sku = String(row.values.sku ?? '').trim()
      const errs = [...row.errors]
      if (!sku) errs.push('variant row is missing variant.sku')
      if (!String(row.values.variant_name ?? '').trim()) errs.push('variant row is missing variant.variant_name')
      // Reject a duplicate variant SKU within the same product — otherwise the publisher throws a
      // hard "SKU already used" error mid-import. Caught here as a clean per-group message.
      if (sku && parent.variants.some(v => v.sku === sku)) {
        errs.push(`duplicate variant.sku "${sku}" under product "${parent.sku}"`)
      }
      if (errs.length) parent.errors.push(`${rowRef(row)}: ${errs.join('; ')}`)
      parent.variants.push({ sku, values: row.values, rowNumber: row.rowNumber, subVariants: [] })
    }
  }

  for (const row of rows) {
    if (row.rowType === 'sub_variant') {
      const parent = row.parentSku && byProductSku.get(row.parentSku)
      if (!parent) {
        orphans.push({ rowNumber: row.rowNumber, message: `sub_variant references unknown parent_sku "${row.parentSku ?? ''}"` })
        continue
      }
      const variant = parent.variants.find(v => v.sku && v.sku === row.variantSku)
      if (!variant) {
        parent.errors.push(`${rowRef(row)}: sub_variant references unknown variant_sku "${row.variantSku ?? ''}"`)
        continue
      }
      const errs = [...row.errors]
      if (!String(row.values.sub_variant_name ?? '').trim()) errs.push('sub_variant row is missing sub_variant.sub_variant_name')
      if (errs.length) parent.errors.push(`${rowRef(row)}: ${errs.join('; ')}`)
      variant.subVariants.push({ values: row.values, rowNumber: row.rowNumber })
    }
  }

  return { groups, orphans }
}
