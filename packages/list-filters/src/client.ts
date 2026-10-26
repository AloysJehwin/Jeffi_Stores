// Client-safe filter field definitions and URL helpers, shared by every admin list.

export type FilterFieldType =
  'select' | 'range' | 'date-range' | 'toggle' | 'boolean' | 'text' | 'multi-select' | 'value-help'

export interface FilterOption {
  value: string
  label: string
}

export interface FilterField {
  name: string | [string, string]
  label: string
  type: FilterFieldType
  options?: FilterOption[]
  section?: string
  placeholder?: string
  unit?: string
  /** Registry key; ranges and dates default their params to `<key>_min/_max` and `<key>_from/_to`. */
  key?: string
  /** Shown as a select on the list toolbar. */
  quick?: boolean
  /** What the value-help counts ("Orders"). */
  noun?: string
}

export type KeyedField<K extends string = string> = FilterField & { key: K }

/** Old param names (and single values) rewritten to canonical ones. With `value`, only that value moves. */
export interface FilterAlias {
  param: string
  to: string
  value?: string
  set?: string
}

export const VALUE_SEPARATOR = '|'
export const RESERVED_PARAMS = ['tab', 'page', 'sort', 'dir', 'view', 'edit'] as const
export const MAX_FILTER_VALUES = 50
export const MAX_VALUE_LENGTH = 200
export const SEARCH_PARAM = 'search'

export type ParamSource =
  | URLSearchParams
  | { get(name: string): string | null; toString(): string }
  | Record<string, string | string[] | number | undefined | null>

const isParams = (sp: ParamSource): sp is URLSearchParams =>
  typeof (sp as URLSearchParams).get === 'function' && typeof (sp as URLSearchParams).toString === 'function'

export function toParams(sp: ParamSource): URLSearchParams {
  if (isParams(sp)) return new URLSearchParams(sp.toString())
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    const first = Array.isArray(v) ? v[0] : v
    if (first != null && String(first) !== '') out.set(k, String(first))
  }
  return out
}

/** Multi-values are pipe-joined; `commas` also splits on commas (fixed-option fields, old links). */
export function splitFilterValues(
  raw: string | string[] | null | undefined,
  opts: { commas?: boolean } = {}
): string[] {
  const sep = opts.commas ? /[|,]/ : VALUE_SEPARATOR
  const parts = (Array.isArray(raw) ? raw : [raw ?? '']).flatMap(r => r.split(sep))
  return [...new Set(parts.map(v => v.trim()).filter(Boolean))]
}

export function joinFilterValues(values: string[]): string {
  return values.join(VALUE_SEPARATOR)
}

/** Escapes LIKE wildcards for a pattern bound as a parameter (default escape char `\`). */
export function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, m => `\\${m}`)
}

export function defaultParamNames(key: string, type: FilterFieldType): string | [string, string] {
  if (type === 'range') return [`${key}_min`, `${key}_max`]
  if (type === 'date-range') return [`${key}_from`, `${key}_to`]
  return key
}

export function paramNamesOf(field: FilterField): string[] {
  return Array.isArray(field.name) ? field.name : [field.name]
}

type FieldInput = Omit<FilterField, 'key' | 'name'> & { name?: FilterField['name'] }

/** Keyed field list in insertion order; the keys type the entity's SQL map. */
export function defineFields<K extends string>(fields: Record<K, FieldInput>): KeyedField<K>[] {
  return (Object.keys(fields) as K[]).map(key => {
    const f = fields[key]
    return { ...f, key, name: f.name ?? defaultParamNames(key, f.type) }
  })
}

export type FieldKeys<T> = T extends ReadonlyArray<{ key: infer K }> ? K : never

/** Applies the alias map; `changed` tells the client to `router.replace` to the canonical URL. */
export function normalizeParams(
  sp: ParamSource,
  aliases: FilterAlias[] = []
): { params: URLSearchParams; changed: boolean } {
  const params = toParams(sp)
  let changed = false
  for (const a of aliases) {
    const raw = params.get(a.param)
    if (raw == null) continue
    if (a.value != null) {
      const vals = splitFilterValues(raw, { commas: true })
      if (!vals.includes(a.value)) continue
      const rest = vals.filter(v => v !== a.value)
      if (rest.length) params.set(a.param, joinFilterValues(rest))
      else params.delete(a.param)
      const target = splitFilterValues(params.get(a.to), { commas: true })
      params.set(a.to, joinFilterValues([...new Set([...target, a.set ?? a.value])]))
    } else {
      params.delete(a.param)
      if (!params.get(a.to)) params.set(a.to, raw)
    }
    changed = true
  }
  return { params, changed }
}

const isMulti = (f: FilterField) => f.type === 'multi-select' || f.type === 'value-help'

/** Only this list's params, in field order, values deduped and pipe-joined: stable for views and links. */
export function canonicalQuery(
  sp: ParamSource,
  fields: FilterField[],
  opts: { search?: string | false; omit?: string[] } = {}
): string {
  const src = toParams(sp)
  const out = new URLSearchParams()
  const omit = new Set(opts.omit ?? [])
  const searchParam = opts.search === false ? null : (opts.search ?? SEARCH_PARAM)
  if (searchParam && !omit.has(searchParam)) {
    const s = src.get(searchParam)?.trim()
    if (s) out.set(searchParam, s)
  }
  for (const f of fields) {
    for (const n of paramNamesOf(f)) {
      if (omit.has(n)) continue
      const raw = src.get(n)
      if (!raw) continue
      const v = isMulti(f) ? joinFilterValues(splitFilterValues(raw, { commas: f.type !== 'value-help' })) : raw.trim()
      if (v) out.set(n, v)
    }
  }
  return out.toString()
}

export function activeCount(sp: ParamSource, fields: FilterField[]): number {
  const p = toParams(sp)
  return fields.filter(f => paramNamesOf(f).some(n => !!p.get(n))).length
}

/** Every param a list owns: its fields, search, and the old alias names. */
export function listParamNames(
  fields: FilterField[],
  opts: { search?: string | false; aliases?: FilterAlias[] } = {}
): string[] {
  const names = fields.flatMap(paramNamesOf)
  if (opts.search !== false) names.push(opts.search ?? SEARCH_PARAM)
  for (const a of opts.aliases ?? []) names.push(a.param)
  return [...new Set(names)]
}
