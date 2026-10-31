import { humanizeLabel } from '@/lib/shared/format'

/**
 * One key per attribute however it was typed: case, brackets and runs of spaces or
 * underscores are dropped, so "Thread Size" / "thread_size" and "Length Range (mm)" /
 * "length_range_mm" meet. specKeySql must stay its exact SQL twin.
 */
export function canonicalSpecKey(raw: string): string {
  return raw
    .replace(/[()]/g, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .toLowerCase()
}

export function specKeySql(expr: string): string {
  return `lower(btrim(regexp_replace(regexp_replace(${expr}, '[()]', '', 'g'), '[_[:space:]]+', ' ', 'g')))`
}

const JUNK_VALUES = ['', 'nan', 'null', 'undefined', 'n/a', '-']
export const SPEC_JUNK_SQL = `(${JUNK_VALUES.map(v => `'${v}'`).join(', ')})`

export function isJunkSpecValue(value: string): boolean {
  return JUNK_VALUES.includes(value.trim().toLowerCase())
}

/** A spec value as display strings: array elements one by one, blanks and placeholders dropped, repeats merged. */
export function specValues(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value]
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (v == null || typeof v === 'object') continue
    const s = String(v).trim()
    if (isJunkSpecValue(s) || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
  }
  return out
}

const readsAsLabel = (key: string) => /[A-Z ]/.test(key) && !key.includes('_')

/** A spec key as written when it already reads as a label, else humanized ("thread_size" -> "Thread Size"). */
export function specLabel(rawKey: string): string {
  const key = rawKey.replace(/\s+/g, ' ').trim()
  return readsAsLabel(key) ? key : humanizeLabel(key)
}

/** Spec keys that restate a product column; the column wins and the spec fills in when the column is empty. */
export const COLUMN_SPEC_ALIASES = {
  material: ['material', 'materials', 'material type'],
  finish: ['finish', 'surface finish'],
  grade: ['grade', 'material grade'],
  color: ['color', 'colour'],
  size: ['size', 'sizes'],
  compliance_standard: [
    'compliance standard',
    'compliance standards',
    'compliance',
    'standard',
    'standards',
    'standard compliance',
  ],
  safety_rating: ['safety rating'],
  brand_part_number: ['part number', 'brand part number'],
  hsn_code: ['hsn code', 'hsn'],
} as const satisfies Record<string, readonly string[]>

export type AliasedColumn = keyof typeof COLUMN_SPEC_ALIASES

export const ALIASED_SPEC_KEYS: ReadonlySet<string> = new Set(Object.values(COLUMN_SPEC_ALIASES).flat())

export interface SpecEntry {
  key: string
  label: string
  values: string[]
}

/** The product's specifications JSON merged by canonical key, in label order. */
export function readSpecifications(specs: unknown): SpecEntry[] {
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
    for (const v of values) {
      if (!entry.values.some(x => x.toLowerCase() === v.toLowerCase())) entry.values.push(v)
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label))
}
