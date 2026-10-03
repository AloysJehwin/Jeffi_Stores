import type { Coercer } from './columns'

export interface CoerceResult {
  value: unknown
  error?: string
}

const TRUE_SET = new Set(['true', '1', 'yes', 'y', 't'])
const FALSE_SET = new Set(['false', '0', 'no', 'n', 'f', ''])

// Turn a raw cell (string | number | boolean | null from the sheet parser) into the
// shape the product_drafts JSONB expects. Blank required cells are left undefined so the
// row-level validation can reject them; blank optional cells fall back to a safe default so
// imports don't corrupt or stall on empty values.
export function coerceCell(raw: unknown, coerce: Coercer, blankIsDefault = false): CoerceResult {
  if (raw === null || raw === undefined) return blankIsDefault ? defaultValueForType(coerce) : { value: undefined }
  const s = String(raw).trim()
  if (s === '') return blankIsDefault ? defaultValueForType(coerce) : { value: undefined }

  switch (coerce) {
    case 'text':
      return { value: s }
    case 'number': {
      const n = Number(s)
      return Number.isFinite(n) ? { value: n } : { value: undefined, error: `not a number: "${s}"` }
    }
    case 'int': {
      const n = Number(s)
      if (!Number.isFinite(n)) return { value: undefined, error: `not a number: "${s}"` }
      if (!Number.isInteger(n)) return { value: undefined, error: `not a whole number: "${s}"` }
      return { value: n }
    }
    case 'bool': {
      const low = s.toLowerCase()
      if (TRUE_SET.has(low)) return { value: true }
      if (FALSE_SET.has(low)) return { value: false }
      return { value: undefined, error: `not true/false: "${s}"` }
    }
    case 'date': {
      const d = new Date(s)
      if (Number.isNaN(d.getTime())) return { value: undefined, error: `not a date: "${s}"` }
      return { value: d.toISOString().slice(0, 10) }
    }
    case 'csv':
      return {
        value: s
          .split(',')
          .map(x => x.trim())
          .filter(Boolean),
      }
    case 'json': {
      try {
        return { value: JSON.parse(s) }
      } catch {
        return { value: undefined, error: `not valid JSON: "${s.slice(0, 40)}"` }
      }
    }
    default:
      return { value: s }
  }
}

function defaultValueForType(coerce: Coercer): CoerceResult {
  switch (coerce) {
    case 'text':
      return { value: '' }
    case 'number':
    case 'int':
      return { value: 0 }
    case 'bool':
      return { value: false }
    case 'csv':
      return { value: [] }
    case 'json':
      return { value: null }
    case 'date':
      return { value: null }
    default:
      return { value: '' }
  }
}

// image_urls is a single pipe-delimited cell (a.jpg|b.jpg) so URLs containing commas
// survive. Returns a de-duplicated, trimmed list.
export function parseImageUrls(raw: unknown): string[] {
  if (raw === null || raw === undefined) return []
  const s = String(raw).trim()
  if (!s) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of s.split('|')) {
    const u = part.trim()
    if (u && !seen.has(u)) {
      seen.add(u)
      out.push(u)
    }
  }
  return out
}
