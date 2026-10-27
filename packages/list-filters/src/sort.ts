export type SortDir = 'asc' | 'desc'

export interface SortSpec {
  key: string
  dir: SortDir
}

/** A list's sortable columns: URL key → SQL expression, its default order, and the unique tie-breaker. */
export interface SortDef {
  sorts: Record<string, string>
  /** ORDER BY body when no sort is picked, e.g. `o.created_at DESC`. */
  defaultSql: string
  /** Unique column(s) appended last so pages never repeat or skip rows, e.g. `o.id`. */
  tiebreak?: string
}

type Params = URLSearchParams | { get(name: string): string | null }

export const normalizeDir = (raw: string | null | undefined, fallback: SortDir = 'desc'): SortDir => {
  const d = (raw ?? '').toLowerCase()
  return d === 'asc' || d === 'desc' ? d : fallback
}

/** The requested sort when it names a whitelisted key; `order` is accepted as an alias of `dir`. */
export function parseSort(params: Params, sorts: Record<string, string> | undefined): SortSpec | null {
  const key = params.get('sort')
  if (!key || !sorts || !Object.hasOwn(sorts, key)) return null
  return { key, dir: normalizeDir(params.get('dir') ?? params.get('order')) }
}

/** `ORDER BY …` for the spec, or the list's default, always ending with the tie-breaker. */
export function orderByClause(def: SortDef, spec: SortSpec | null): string {
  const parts: string[] = []
  if (spec && Object.hasOwn(def.sorts, spec.key)) {
    parts.push(`${def.sorts[spec.key]} ${spec.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`)
  } else {
    parts.push(def.defaultSql)
  }
  if (def.tiebreak) parts.push(def.tiebreak)
  return `ORDER BY ${parts.join(', ')}`
}

/** parseSort + orderByClause in one step. */
export const sortClause = (params: Params, def: SortDef) => orderByClause(def, parseSort(params, def.sorts))
