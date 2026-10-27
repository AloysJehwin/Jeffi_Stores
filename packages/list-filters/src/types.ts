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

/**
 * One table of a UNION entity (invoices: orders + cash sales). Every field needs SQL in each branch;
 * a constant expression (`'cash_sale'::text`, `NULL::text`, `false`) just leaves the branch's rows out.
 */
export interface FilterBranch<K extends string = string> {
  key: string
  root: string
  alias: string
  pk?: string
  base?: string[]
  sql: Record<K, FieldSql>
  search?: (q: string, startIdx: number) => SearchClause
  /** This branch's SQL per export column key (missing ones are NULL) and its keyset. */
  export?: { columns: Record<string, string>; keyset: string[] }
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
  /** Base conditions bound from request context (e.g. the tenant id); applied even when `base` is skipped. */
  boundBase?: Sql[]
  fields: KeyedField<K>[]
  sql: Record<K, FieldSql>
  /** The main date field; its params are `from` / `to`, which double as the Overview period. */
  period?: K
  aliases?: FilterAlias[]
  search?: { param?: string; build: (q: string, startIdx: number) => SearchClause }
  sorts?: Record<string, string>
  /** ORDER BY body with no sort picked, and the unique tie-breaker (see `SortDef`). */
  defaultSql?: string
  tiebreak?: string
  facets?: boolean
  defaultWindowDays?: number
  /** Loads what context-bound predicates need; called only by the runners. */
  context?: (q: FilterQuery) => Promise<FilterCtx>
  export?: { columns: ExportColumn[]; keyset: string[]; cap?: number }
  /** Adapter for a list whose filter SQL lives elsewhere (products); replaces `fields` / `sql`. */
  custom?: CustomFilters
  /** UNION entities: root / alias / sql above mirror the first branch (see `unionEntity`). */
  branches?: FilterBranch<K>[]
}

export interface CustomFilters {
  /** The list's own params from the URL, validated. */
  normalize(params: URLSearchParams): FilterQuery
  /** Conditions on the root alias, binding from `startIdx`. */
  clauses(q: FilterQuery, startIdx: number): Clauses
  /** One page of a value-help field; null for a field without value help. */
  values?(
    field: string,
    opts: { search?: string; page?: number }
  ): Promise<{ values: { value: string; count: number }[]; hasMore: boolean } | null>
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
  /** A UNION entity's branch key. */
  branch?: string
}

export interface ScopeSql {
  sql: string
  params: unknown[]
}

/** Filters an overview appends to its own queries: `and(start)` on the root alias, `inIds` on related tables. */
export interface FilterScope {
  empty: boolean
  and(start: number, branch?: string): ScopeSql
  inIds(col: string, start: number): ScopeSql
}
