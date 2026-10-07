import type { ParsedRow } from './parse'
import {
  MAX_BILLING_CYCLES,
  MAX_CYCLE_AMOUNT_INR,
  SUBSCRIPTION_INTERVALS,
  isSubscriptionInterval,
} from '@/lib/subscriptions/intervals'
import { subscriptionPriceKey } from './columns'
import { DIGITAL_UNIT_MESSAGE } from '@/lib/catalog/digital-units'

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
  warnings: string[]
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
        sku,
        name,
        values: row.values,
        imageUrls: row.imageUrls,
        rowNumber: row.rowNumber,
        variants: [],
        errors,
        warnings: [],
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
        orphans.push({
          rowNumber: row.rowNumber,
          message: `variant references unknown parent_sku "${row.parentSku ?? ''}"`,
        })
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
        orphans.push({
          rowNumber: row.rowNumber,
          message: `sub_variant references unknown parent_sku "${row.parentSku ?? ''}"`,
        })
        continue
      }
      const variant = parent.variants.find(v => v.sku && v.sku === row.variantSku)
      if (!variant) {
        parent.errors.push(`${rowRef(row)}: sub_variant references unknown variant_sku "${row.variantSku ?? ''}"`)
        continue
      }
      const errs = [...row.errors]
      if (!String(row.values.sub_variant_name ?? '').trim())
        errs.push('sub_variant row is missing sub_variant.sub_variant_name')
      if (errs.length) parent.errors.push(`${rowRef(row)}: ${errs.join('; ')}`)
      variant.subVariants.push({ values: row.values, rowNumber: row.rowNumber })
    }
  }

  for (const g of groups) {
    checkDigital(g)
    checkSubscription(g)
  }

  return { groups, orphans }
}

const isTrue = (v: unknown) => v === true || String(v).toLowerCase() === 'true'

// Digital products sell as one piece: no variant / sub-variant rows (and so no variant units).
function checkDigital(g: ProductGroup): void {
  if (!isTrue(g.values.is_digital)) return
  if (g.variants.length > 0) {
    g.errors.push(`digital products cannot have variant or sub-variant rows (${DIGITAL_UNIT_MESSAGE})`)
  } else if (isTrue(g.values.has_variants)) {
    g.errors.push('digital products cannot have variants (has_variants must be FALSE)')
  }
}

/** "weekly|Monthly, yearly" → ['weekly','monthly','yearly'] in canonical order; invalid entries returned separately. */
export function parseSubscriptionIntervals(raw: unknown): { intervals: string[]; invalid: string[] } {
  const parts = String(raw ?? '')
    .split(/[|,]/)
    .map(x => x.trim().toLowerCase())
    .filter(Boolean)
  const invalid = parts.filter(x => !isSubscriptionInterval(x))
  return { intervals: SUBSCRIPTION_INTERVALS.filter(i => parts.includes(i)), invalid }
}

// subscription_price_<interval> cells → values.subscription_prices (only when any cell is filled).
function foldIntervalPrices(values: Record<string, unknown>, label: string, errors: string[]): void {
  const prices: Record<string, number> = {}
  let any = false
  for (const iv of SUBSCRIPTION_INTERVALS) {
    const key = subscriptionPriceKey(iv)
    if (values[key] === undefined) continue
    any = true
    const n = Number(values[key])
    delete values[key]
    if (!Number.isFinite(n) || n < 0) errors.push(`${label}${key} must be 0 or more`)
    else if (n > MAX_CYCLE_AMOUNT_INR) errors.push(`${label}${key} cannot exceed ₹15,000 per cycle`)
    else if (n > 0) prices[iv] = Math.round(n * 100) / 100
  }
  if (any) values.subscription_prices = prices
}

// Intervals / cycle limits, and the sellable rule for subscription prices: only the product (no
// variants), a variant without sub-variants, or a sub-variant carries them.
function checkSubscription(g: ProductGroup): void {
  const v = g.values
  foldIntervalPrices(v, '', g.errors)
  for (const variant of g.variants) {
    foldIntervalPrices(variant.values, `variant "${variant.sku}": `, g.errors)
    for (const sv of variant.subVariants) foldIntervalPrices(sv.values, `sub-variant row ${sv.rowNumber}: `, g.errors)
  }
  if (v.subscription_intervals !== undefined) {
    const { intervals, invalid } = parseSubscriptionIntervals(v.subscription_intervals)
    if (invalid.length) {
      g.errors.push(
        `subscription_intervals: unknown "${invalid.join('", "')}" (use ${SUBSCRIPTION_INTERVALS.join(' | ')})`
      )
    }
    v.subscription_intervals = intervals
  }
  const total = v.subscription_total_cycles as number | undefined
  const min = v.subscription_min_cycles as number | undefined
  if (total !== undefined && (total < 1 || total > MAX_BILLING_CYCLES)) {
    g.errors.push(`subscription_total_cycles must be between 1 and ${MAX_BILLING_CYCLES}`)
  }
  if (min !== undefined && min < 1) g.errors.push('subscription_min_cycles must be greater than 0')
  if (total !== undefined && min !== undefined && min > total) {
    g.errors.push('subscription_min_cycles cannot exceed subscription_total_cycles')
  }

  if (v.subscription_price !== undefined && (g.variants.length > 0 || isTrue(v.has_variants))) {
    g.warnings.push('subscription_price ignored on a product with variants (set it per variant / sub-variant)')
    delete v.subscription_price
  }
  if (v.subscription_prices !== undefined && (g.variants.length > 0 || isTrue(v.has_variants))) {
    g.warnings.push('subscription_price_<interval> ignored on a product with variants (set them per variant / sub-variant)')
    delete v.subscription_prices
  }
  for (const variant of g.variants) {
    if (variant.values.subscription_price !== undefined && variant.subVariants.length > 0) {
      g.warnings.push(
        `variant "${variant.sku}": subscription_price ignored (variant has sub-variants; set it per sub-variant)`
      )
      delete variant.values.subscription_price
    }
    if (variant.values.subscription_prices !== undefined && variant.subVariants.length > 0) {
      g.warnings.push(
        `variant "${variant.sku}": subscription_price_<interval> ignored (variant has sub-variants; set them per sub-variant)`
      )
      delete variant.values.subscription_prices
    }
  }
}
