// Port of controller-service components/visitor/pdp/spec-groups.ts + lib/catalog/product-specs.ts.

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

type Src = Record<string, any>

export function humanizeLabel(raw: string): string {
  if (!raw) return raw
  const tokens = raw.split(/[_\s-]+/).filter(Boolean)
  if (tokens.length === 0) return raw
  return (
    tokens
      .map(t => (/^[A-Z0-9]+$/.test(t) || /\d/.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()))
      .join(' ') || raw
  )
}

function canonicalSpecKey(raw: string): string {
  return raw.replace(/[()]/g, '').replace(/[_\s]+/g, ' ').trim().toLowerCase()
}

const JUNK_VALUES = ['', 'nan', 'null', 'undefined', 'n/a', '-']

function specValues(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value]
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (v == null || typeof v === 'object') continue
    const s = String(v).trim()
    if (JUNK_VALUES.includes(s.toLowerCase()) || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
  }
  return out
}

const readsAsLabel = (key: string) => /[A-Z ]/.test(key) && !key.includes('_')

function specLabel(rawKey: string): string {
  const key = rawKey.replace(/\s+/g, ' ').trim()
  return readsAsLabel(key) ? key : humanizeLabel(key)
}

const COLUMN_SPEC_ALIASES = {
  material: ['material', 'materials', 'material type'],
  finish: ['finish', 'surface finish'],
  grade: ['grade', 'material grade'],
  color: ['color', 'colour'],
  size: ['size', 'sizes'],
  compliance_standard: ['compliance standard', 'compliance standards', 'compliance', 'standard', 'standards', 'standard compliance'],
  safety_rating: ['safety rating'],
  brand_part_number: ['part number', 'brand part number'],
  hsn_code: ['hsn code', 'hsn'],
} as const

type AliasedColumn = keyof typeof COLUMN_SPEC_ALIASES

const ALIASED_SPEC_KEYS: ReadonlySet<string> = new Set(Object.values(COLUMN_SPEC_ALIASES).flat())

interface SpecEntry {
  key: string
  label: string
  values: string[]
}

function readSpecifications(specs: unknown): SpecEntry[] {
  if (!specs || typeof specs !== 'object' || Array.isArray(specs)) return []
  const byKey = new Map<string, SpecEntry>()
  const labelledAsWritten = new Set<string>()
  for (const [rawKey, rawValue] of Object.entries(specs as Record<string, unknown>)) {
    const key = canonicalSpecKey(rawKey)
    const values = specValues(rawValue)
    if (!key || values.length === 0) continue
    const asWritten = readsAsLabel(rawKey.trim())
    const entry = byKey.get(key)
    if (!entry) {
      byKey.set(key, { key, label: specLabel(rawKey), values })
      if (asWritten) labelledAsWritten.add(key)
      continue
    }
    if (asWritten && !labelledAsWritten.has(key)) {
      entry.label = specLabel(rawKey)
      labelledAsWritten.add(key)
    }
    for (const v of values) if (!entry.values.some(x => x.toLowerCase() === v.toLowerCase())) entry.values.push(v)
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label))
}

const HANDLING_FLAGS: HandlingFlag[] = ['fragile', 'hazardous', 'flammable', 'perishable']

const INTERNAL_SPEC_KEYS: ReadonlySet<string> = new Set([
  'sku', 'mrp', 'price', 'cost', 'cost price', 'selling price', 'gst', 'gst rate', 'tax', 'supplier', 'category',
  'barcode', 'ean', 'asin', 'stock', 'inventory', 'package type', 'packing type', 'packaging type', 'package dimensions',
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

function countryName(code: string): string {
  if (!/^[a-z]{2}$/i.test(code)) return code
  try {
    const names = new (Intl as any).DisplayNames(['en'], { type: 'region' })
    return names.of(code.toUpperCase()) || code
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

/** The customer-facing specifications of a product row, grouped. */
export function buildSpecGroups(p: Src): { handling: HandlingFlag[]; groups: SpecGroup[] } {
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
  const compliance = specValues([...list(p.compliance_standard), ...aliased('compliance_standard').flatMap(v => v.split(','))])
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
        ? [row('License', text(p.license_type)), row('File format', text(p.file_format)), row('Works with', list(p.platform_compatibility).join(', '))]
        : []),
    ]),
    group(
      'technical',
      'Technical specifications',
      specs
        .filter(e => !ALIASED_SPEC_KEYS.has(e.key) && !INTERNAL_SPEC_KEYS.has(e.key) && e.key !== 'dimensions')
        .map(e => row(e.label, e.values.join(', ')))
    ),
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
      row(
        'Suitable for',
        [ageRange(positive(p.age_min), positive(p.age_max)), gender.toLowerCase() === 'unisex' ? '' : humanizeLabel(gender), ...list(p.target_audience)]
          .filter(Boolean)
          .join(', ')
      ),
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
