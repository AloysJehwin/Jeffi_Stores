import type { FilterAlias, KeyedField } from './client'
import type { SearchClause } from './search'

/** Binds a value as the next `$n` and returns the placeholder. */
export type Bind = (value: unknown) => string

/** Per-request values some predicates need (e.g. the store's handling days). */
export type FilterCtx = Record<string, unknown>

/** SQL text, or a builder for text that binds context values. */
export type Sql = string | ((ctx: FilterCtx, bind: Bind) => string)

/** Canonical query: param name → normalised value (multi-values pipe-joined). */
export type FilterQuery = Record<string, string>

/** Rows correlated to the root alias: `SELECT expr FROM from WHERE link`. Several exprs are unioned. */
export interface Lateral {
  from: string
  link: string
  expr: string | string[]
}

/**
 * How one field filters. Every expression refers only to the entity's root alias; anything joined
 * is a correlated EXISTS or a scalar subquery, so one clause set drives list, count, KPIs, overview,
 * value lists and export.
 */
export type FieldSql =
  /** Multi-value `IN`; `virtual` options carry their own SQL (OR-ed with the real ones). */
  | {
      kind: 'enum'
      expr?: string
      cast?: string
      exists?: { from: string; link: string }
      virtual?: Record<string, Sql>
    }
  /** Value help: case-folded match on a column, an array, or correlated rows. */
  | { kind: 'values'; expr?: string; array?: string; lateral?: Lateral; fold?: 'lower' | 'upper'; uuid?: boolean }
  | { kind: 'range'; expr: string }
  /** IST day bounds on a timestamptz; `dateOnly` for `date` columns. */
  | { kind: 'date'; expr: string; dateOnly?: boolean }
  /** true / false; `expr` must never be NULL. */
  | { kind: 'bool'; expr: Sql }
  /** Applies only when set to true. */
  | { kind: 'flag'; expr: Sql }
  | { kind: 'text'; expr: string | string[]; match?: 'contains' | 'prefix' | 'exact' }
  | { kind: 'custom'; build: (q: FilterQuery, bind: Bind, ctx: FilterCtx) => string | null }

export interface ExportColumn {
  key: string
  label: string
  sql: string
}

export interface FilterEntity<K extends string = string> {
  key: string
  scope: string
  /** Sharing views; defaults to `scope` with `:read` → `:write`. */
  writeScope?: string
  exportScope?: string
  noun: string
  db?: 'tenant' | 'control'
  root: string
  alias: string
  pk?: string
  base?: string[]
  fields: KeyedField<K>[]
  sql: Record<K, FieldSql>
  /** The main date field; its params are `from` / `to`, which double as the Overview period. */
  period?: K
  aliases?: FilterAlias[]
  search?: { param?: string; build: (q: string, startIdx: number) => SearchClause }
  sorts?: Record<string, string>
  facets?: boolean
  defaultWindowDays?: number
  /** Loads what context-bound predicates need; called only by the runners. */
  context?: (q: FilterQuery) => Promise<FilterCtx>
  export?: { columns: ExportColumn[]; keyset: string[]; cap?: number }
}

export interface Clauses {
  conditions: string[]
  params: unknown[]
  nextIdx: number
}

export interface ClauseOpts {
  omit?: string[]
  only?: string[]
  ctx?: FilterCtx
}

export interface ScopeSql {
  sql: string
  params: unknown[]
}

/** Filters an overview appends to its own queries: `and(start)` on the root alias, `inIds` on related tables. */
export interface FilterScope {
  empty: boolean
  and(start: number): ScopeSql
  inIds(col: string, start: number): ScopeSql
}
