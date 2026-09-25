import { humanizeLabel } from '@/lib/format'
import {
  ALIASED_SPEC_KEYS,
  COLUMN_SPEC_ALIASES,
  readSpecifications,
  specValues,
  type AliasedColumn,
} from '@/lib/product-specs'

export type HandlingFlag = 'fragile' | 'hazardous' | 'flammable' | 'perishable'

export interface SpecRow {
  label: string
  value: string
  chips?: string[]
  copy?: boolean
}

export interface SpecGroup {
  id: string
  title: string
  rows: SpecRow[]
}

type SpecColumn =
  | AliasedColumn
  | HandlingFlag
  | 'sku' | 'mpn' | 'gtin' | 'barcode' | 'isbn' | 'gst_percentage'
  | 'dimensions' | 'net_weight_grams' | 'volume_ml'
  | 'is_digital' | 'license_type' | 'file_format' | 'platform_compatibility'
  | 'certifications' | 'warranty_months' | 'warranty_type' | 'country_of_origin' | 'shelf_life_days'
  | 'condition' | 'age_min' | 'age_max' | 'target_gender' | 'target_audience'

export type SpecSource = Partial<Record<SpecColumn, string | number | boolean | string[] | null>> & {
  brands?: { name?: string | null } | null
  specifications?: unknown
}

const HANDLING_FLAGS: HandlingFlag[] = ['fragile', 'hazardous', 'flammable', 'perishable']

const INTERNAL_SPEC_KEYS: ReadonlySet<string> = new Set([
  'sku', 'mrp', 'price', 'cost', 'cost price', 'selling price', 'gst', 'gst rate', 'tax', 'supplier', 'category',
  'barcode', 'ean', 'asin', 'stock', 'inventory',
  'package type', 'packing type', 'packaging type', 'package dimensions',
])

const text = (value: unknown): string => specValues(value).join(', ')

const list = (value: unknown): string[] => specValues(typeof value === 'string' ? value.split(',') : value)

function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function positive(value: unknown): number | null {
  const n = numeric(value)
  return n != null && n > 0 ? n : null
}

const trimmed = (n: number): string => String(Math.round(n * 100) / 100)

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`

function metric(amount: number | null, unit: string, thousandUnit: string): string {
  if (amount == null) return ''
  return amount < 1000 ? `${trimmed(amount)} ${unit}` : `${trimmed(amount / 1000)} ${thousandUnit}`
}

function warranty(months: number | null, type: string): string {
  if (months == null) return ''
  const span = months % 12 === 0 ? plural(months / 12, 'year') : plural(months, 'month')
  return type ? `${span} (${humanizeLabel(type)})` : span
}

function shelfLife(days: number | null): string {
  if (days == null) return ''
  if (days % 365 === 0) return plural(days / 365, 'year')
  if (days % 30 === 0) return plural(days / 30, 'month')
  return plural(days, 'day')
}

let regionNames: Intl.DisplayNames | undefined

function countryName(code: string): string {
  if (!/^[a-z]{2}$/i.test(code)) return code
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code.toUpperCase()) || code
  } catch {
    return code
  }
}

function ageRange(min: number | null, max: number | null): string {
  if (min != null && max != null) return min === max ? plural(min, 'year') : `${min} to ${max} years`
  if (min != null) return `${min}+ years`
  return max != null ? `Up to ${max} years` : ''
}

function row(label: string, value: string, extra: Omit<SpecRow, 'label' | 'value'> = {}): SpecRow | null {
  return value ? { label, value, ...extra } : null
}

function group(id: string, title: string, rows: (SpecRow | null)[]): SpecGroup | null {
  const kept = rows.filter((r): r is SpecRow => r !== null)
  return kept.length > 0 ? { id, title, rows: kept } : null
}

/** The customer-facing specifications of a product row, grouped; packaging, logistics and internal fields are left out. */
export function buildSpecGroups(product: SpecSource): { handling: HandlingFlag[]; groups: SpecGroup[] } {
  const p = product
  const specs = readSpecifications(p.specifications)
  const byKey = new Map(specs.map(entry => [entry.key, entry]))
  const aliased = (column: AliasedColumn): string[] =>
    specValues(COLUMN_SPEC_ALIASES[column].flatMap(key => byKey.get(key)?.values ?? []))
  const columnOrSpec = (column: AliasedColumn): string => text(p[column]) || aliased(column).join(', ')

  const partNumber = columnOrSpec('brand_part_number') || text(p.mpn)
  const mpn = text(p.mpn)
  const gst = numeric(p.gst_percentage)
  const origin = text(p.country_of_origin)
  const condition = text(p.condition)
  const gender = text(p.target_gender)
  const compliance = specValues([
    ...list(p.compliance_standard),
    ...aliased('compliance_standard').flatMap(value => value.split(',')),
  ])
  const certifications = list(p.certifications)

  const groups = [
    group('key-details', 'Key details', [
      row('Brand', text(p.brands?.name)),
      row('Part number', partNumber),
      row('Material', columnOrSpec('material')),
      row('Grade', columnOrSpec('grade')),
      row('Finish', columnOrSpec('finish')),
      row('Color', columnOrSpec('color')),
      row('Size', columnOrSpec('size')),
      row('Dimensions', text(p.dimensions) || (byKey.get('dimensions')?.values.join(', ') ?? '')),
      row('Net weight', metric(positive(p.net_weight_grams), 'g', 'kg')),
      row('Volume', metric(positive(p.volume_ml), 'ml', 'L')),
      ...(p.is_digital === true
        ? [
            row('License', text(p.license_type)),
            row('File format', text(p.file_format)),
            row('Works with', list(p.platform_compatibility).join(', ')),
          ]
        : []),
    ]),
    group('technical', 'Technical specifications', specs
      .filter(entry => !ALIASED_SPEC_KEYS.has(entry.key) && !INTERNAL_SPEC_KEYS.has(entry.key) && entry.key !== 'dimensions')
      .map(entry => row(entry.label, entry.values.join(', ')))),
    group('standards', 'Standards and safety', [
      row('Compliance', compliance.join(', '), { chips: compliance }),
      row('Certifications', certifications.join(', '), { chips: certifications }),
      row('Safety rating', columnOrSpec('safety_rating')),
    ]),
    group('warranty', 'Warranty and origin', [
      row('Warranty', warranty(positive(p.warranty_months), text(p.warranty_type))),
      row('Country of origin', origin && countryName(origin)),
      row('Shelf life', shelfLife(positive(p.shelf_life_days))),
      row('Condition', condition.toLowerCase() === 'new' ? '' : humanizeLabel(condition)),
      row('Suitable for', [
        ageRange(positive(p.age_min), positive(p.age_max)),
        gender.toLowerCase() === 'unisex' ? '' : humanizeLabel(gender),
        ...list(p.target_audience),
      ].filter(Boolean).join(', ')),
    ]),
    group('codes', 'Product codes', [
      row('SKU', text(p.sku), { copy: true }),
      row('MPN', mpn.toLowerCase() === partNumber.toLowerCase() ? '' : mpn),
      row('GTIN / EAN', text(p.gtin) || text(p.barcode)),
      row('ISBN', text(p.isbn)),
      row('HSN code', columnOrSpec('hsn_code')),
      row('GST rate', gst != null && gst >= 0 ? `${trimmed(gst)}%` : ''),
    ]),
  ].filter((g): g is SpecGroup => g !== null)

  return { handling: HANDLING_FLAGS.filter(flag => p[flag] === true), groups }
}
