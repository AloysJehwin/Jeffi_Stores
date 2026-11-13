// Field specs for brand / category profile columns: one list drives form inputs, parsing, draft
// content and the UPDATE, so a new column is added in one place. Client-safe (no DB import).

export type FieldKind = 'text' | 'longtext' | 'url' | 'int' | 'decimal' | 'bool' | 'tristate' | 'list' | 'links' | 'select' | 'color'

export interface FieldSpec {
  key: string
  label: string
  kind: FieldKind
  section: string
  hint?: string
  placeholder?: string
  max?: number
  min?: number
  maxValue?: number
  options?: Array<{ value: string; label: string }>
  /** links: the keys of the jsonb object. */
  subkeys?: string[]
  /** Never null (NOT NULL column): the value an empty input saves. */
  fallback?: unknown
}

const SQL_CAST: Record<FieldKind, string> = {
  text: '::text',
  longtext: '::text',
  url: '::text',
  color: '::text',
  select: '::text',
  int: '::integer',
  decimal: '::numeric',
  bool: '::boolean',
  tristate: '::boolean',
  list: '::text[]',
  links: '::jsonb',
}

const str = (v: unknown) => (v == null ? '' : String(v)).trim()

/** Normalises a form or DB value to what the column stores (null when empty). */
export function parseField(spec: FieldSpec, raw: unknown): unknown {
  let v: unknown
  switch (spec.kind) {
    case 'int':
    case 'decimal': {
      const n = spec.kind === 'int' ? parseInt(str(raw), 10) : parseFloat(str(raw))
      v = Number.isFinite(n) && (spec.min == null || n >= spec.min) && (spec.maxValue == null || n <= spec.maxValue) ? n : null
      break
    }
    case 'bool':
      v = raw === true || raw === 'true' || raw === 'on' || raw === '1'
      break
    case 'tristate':
      v = raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : null
      break
    case 'list': {
      const items = Array.isArray(raw) ? raw : str(raw).split(/[\n,]/)
      v = [...new Set(items.map(i => str(i)).filter(Boolean))].slice(0, 50)
      break
    }
    case 'links': {
      const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
      v = Object.fromEntries((spec.subkeys ?? []).map(k => [k, str(obj[k])]).filter(([, val]) => val))
      break
    }
    case 'select': {
      const s = str(raw)
      v = spec.options?.some(o => o.value === s) ? s : null
      break
    }
    case 'color': {
      const s = str(raw)
      v = /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null
      break
    }
    default: {
      const s = str(raw)
      v = s ? (spec.max ? s.slice(0, spec.max) : s) : null
    }
  }
  return v == null && spec.fallback !== undefined ? spec.fallback : v
}

/** Reads the specs' inputs from a form post. A field with no input in the form is left out (not cleared). */
export function parseFields(specs: FieldSpec[], form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    if (spec.kind === 'links') {
      const keys = (spec.subkeys ?? []).filter(k => form.has(`${spec.key}.${k}`))
      if (!keys.length) continue
      out[spec.key] = parseField(spec, Object.fromEntries(keys.map(k => [k, form.get(`${spec.key}.${k}`)])))
    } else if (form.has(spec.key)) {
      out[spec.key] = parseField(spec, form.get(spec.key))
    }
  }
  return out
}

/** Same for a JSON body (API routes): only keys present in the body. */
export function parseBodyFields(specs: FieldSpec[], body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(specs.filter(s => s.key in body).map(s => [s.key, parseField(s, body[s.key])]))
}

/** Row values in the shape parseField returns, so drafts compare like with like. */
export function contentOfSpecs(specs: FieldSpec[], row: Record<string, any>): Record<string, unknown> {
  return Object.fromEntries(specs.map(s => [s.key, parseField(s, row[s.key])]))
}

/**
 * `SET col = $n::cast, …` for the spec keys present in `values`; params continue from `startAt`.
 * Returns null when nothing is present.
 */
export function specUpdate(
  specs: FieldSpec[],
  values: Record<string, unknown>,
  startAt: number
): { set: string; params: unknown[] } | null {
  const present = specs.filter(s => s.key in values)
  if (!present.length) return null
  const params: unknown[] = []
  const set = present
    .map(s => {
      const v = parseField(s, values[s.key])
      params.push(s.kind === 'links' ? JSON.stringify(v ?? {}) : v)
      return `${s.key} = $${startAt + params.length - 1}${SQL_CAST[s.kind]}`
    })
    .join(', ')
  return { set, params }
}

export const specLabels = (specs: FieldSpec[]) => Object.fromEntries(specs.map(s => [s.key, s.label]))
