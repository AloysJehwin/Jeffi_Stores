import {
  MAX_FILTER_VALUES,
  MAX_VALUE_LENGTH,
  SEARCH_PARAM,
  escapeLike,
  joinFilterValues,
  normalizeParams,
  paramNamesOf,
  splitFilterValues,
  type KeyedField,
  type ParamSource,
} from './client'
import type { SearchClause } from './search'
import type {
  Bind,
  ClauseOpts,
  Clauses,
  FieldSql,
  FilterBranch,
  FilterCtx,
  FilterEntity,
  FilterQuery,
  FilterScope,
  Sql,
} from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isNumber = (v: string) => v !== '' && Number.isFinite(Number(v))
const isDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
const sqlOf = (s: Sql, ctx: FilterCtx, bind: Bind) => (typeof s === 'function' ? s(ctx, bind) : s)
const cleanList = (raw: string | null | undefined, commas: boolean) =>
  splitFilterValues(raw, { commas })
    .filter(v => v.length <= MAX_VALUE_LENGTH)
    .slice(0, MAX_FILTER_VALUES)

export const IST_FROM = (p: string) => `(${p}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`
export const IST_TO = (p: string) => `(${p}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`

export function searchParamOf(entity: FilterEntity): string {
  return entity.search?.param ?? SEARCH_PARAM
}

/** Aliases applied, unknown and reserved keys dropped, values capped and validated. */
export function normalizeQuery<K extends string>(entity: FilterEntity<K>, sp: ParamSource): FilterQuery {
  const { params } = normalizeParams(sp, entity.aliases)
  const q: FilterQuery = {}
  if (entity.search) {
    const p = searchParamOf(entity as FilterEntity)
    const s = params.get(p)?.trim().slice(0, MAX_VALUE_LENGTH)
    if (s) q[p] = s
  }
  if (entity.custom) return { ...q, ...entity.custom.normalize(params) }
  for (const f of entity.fields) {
    const s: FieldSql = entity.sql[f.key]
    const names = paramNamesOf(f)
    const one = (n: string) => params.get(n)?.trim() ?? ''
    switch (s.kind) {
      case 'enum': {
        const known = [...(f.options ?? []).map(o => o.value), ...Object.keys(s.virtual ?? {})]
        const allowed = known.length ? new Set(known) : null
        const vals = cleanList(params.get(names[0]), true).filter(v => !allowed || allowed.has(v))
        if (vals.length) q[names[0]] = joinFilterValues(vals)
        break
      }
      case 'values': {
        const vals = cleanList(params.get(names[0]), false).filter(v => !s.uuid || UUID_RE.test(v))
        if (vals.length) q[names[0]] = joinFilterValues(vals)
        break
      }
      case 'range':
        for (const n of names) if (isNumber(one(n))) q[n] = one(n)
        break
      case 'date':
        for (const n of names) if (isDate(one(n))) q[n] = one(n)
        break
      case 'bool':
        if (one(names[0]) === 'true' || one(names[0]) === 'false') q[names[0]] = one(names[0])
        break
      case 'flag':
        if (one(names[0]) === 'true' || one(names[0]) === '1') q[names[0]] = 'true'
        break
      case 'text':
      case 'custom':
        for (const n of names) {
          const v = one(n).slice(0, MAX_VALUE_LENGTH)
          if (v) q[n] = v
        }
        break
    }
  }
  return q
}

/** Rows of a value-help source, correlated to the root alias, one `val` each. */
export function rowsSql(s: Extract<FieldSql, { kind: 'values' }>): string {
  const parts: string[] = []
  if (s.expr) parts.push(`SELECT btrim(${s.expr}) AS val`)
  if (s.array) parts.push(`SELECT btrim(y) AS val FROM unnest(${s.array}) y`)
  if (s.lateral) {
    const { from, link } = s.lateral
    for (const e of [s.lateral.expr].flat()) parts.push(`SELECT btrim(${e}) AS val FROM ${from} WHERE ${link}`)
  }
  return parts.join(' UNION ALL ')
}

function matchValues(s: Extract<FieldSql, { kind: 'values' }>, values: string[], bind: Bind): string | null {
  if (!values.length) return null
  const fold = s.fold ?? 'lower'
  const wanted = values.map(v => `${fold}(${bind(v)})`).join(', ')
  const parts: string[] = []
  if (s.expr) parts.push(`${fold}(btrim(${s.expr})) IN (${wanted})`)
  if (s.array) parts.push(`EXISTS (SELECT 1 FROM unnest(${s.array}) y WHERE ${fold}(btrim(y)) IN (${wanted}))`)
  if (s.lateral) {
    const exprs = [s.lateral.expr].flat().map(e => `${fold}(btrim(${e})) IN (${wanted})`)
    parts.push(
      `EXISTS (SELECT 1 FROM ${s.lateral.from} WHERE ${s.lateral.link} AND ${exprs.length > 1 ? `(${exprs.join(' OR ')})` : exprs[0]})`
    )
  }
  return parts.length > 1 ? `(${parts.join(' OR ')})` : (parts[0] ?? null)
}

function fieldConditions(f: KeyedField, s: FieldSql, q: FilterQuery, bind: Bind, ctx: FilterCtx): string[] {
  const names = paramNamesOf(f)
  const v = q[names[0]]
  switch (s.kind) {
    case 'enum': {
      if (!v) return []
      const vals = splitFilterValues(v, { commas: true })
      const virtual = s.virtual ?? {}
      const real = vals.filter(x => !Object.hasOwn(virtual, x))
      const parts: string[] = []
      if (real.length && s.expr) {
        const inSql = `${s.expr} IN (${real.map(x => (s.cast ? `${bind(x)}::${s.cast}` : bind(x))).join(', ')})`
        parts.push(s.exists ? `EXISTS (SELECT 1 FROM ${s.exists.from} WHERE ${s.exists.link} AND ${inSql})` : inSql)
      }
      for (const x of vals) if (Object.hasOwn(virtual, x)) parts.push(`(${sqlOf(virtual[x], ctx, bind)})`)
      if (!parts.length) return []
      return [parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`]
    }
    case 'values': {
      const m = v ? matchValues(s, splitFilterValues(v), bind) : null
      return m ? [m] : []
    }
    case 'range': {
      const out: string[] = []
      if (q[names[0]]) out.push(`${s.expr} >= ${bind(q[names[0]])}::numeric`)
      if (names[1] && q[names[1]]) out.push(`${s.expr} <= ${bind(q[names[1]])}::numeric`)
      return out
    }
    case 'date': {
      const out: string[] = []
      const from = q[names[0]]
      const to = names[1] ? q[names[1]] : undefined
      if (s.dateOnly) {
        if (from) out.push(`${s.expr} >= ${bind(from)}::date`)
        if (to) out.push(`${s.expr} <= ${bind(to)}::date`)
      } else {
        if (from) out.push(`${s.expr} >= ${IST_FROM(bind(from))}`)
        if (to) out.push(`${s.expr} < ${IST_TO(bind(to))}`)
      }
      return out
    }
    case 'bool':
      if (v === 'true') return [`(${sqlOf(s.expr, ctx, bind)})`]
      if (v === 'false') return [`NOT (${sqlOf(s.expr, ctx, bind)})`]
      return []
    case 'flag':
      return v === 'true' ? [`(${sqlOf(s.expr, ctx, bind)})`] : []
    case 'text': {
      if (!v) return []
      const match = s.match ?? 'contains'
      const p = bind(match === 'exact' ? v : escapeLike(v))
      const one = (e: string) =>
        match === 'exact'
          ? `lower(${e}) = lower(${p})`
          : match === 'prefix'
            ? `${e} ILIKE ${p} || '%'`
            : `${e} ILIKE '%' || ${p} || '%'`
      const exprs = [s.expr].flat()
      return [exprs.length > 1 ? `(${exprs.map(one).join(' OR ')})` : one(exprs[0])]
    }
    case 'custom': {
      if (!names.some(n => q[n])) return []
      const c = s.build(q, bind, ctx)
      return c ? [c] : []
    }
  }
}

const NO_MATCH = (_q: string, idx: number): SearchClause => ({ clause: 'FALSE', params: [], nextIdx: idx })

function branchView<K extends string>(entity: FilterEntity<K>, b: FilterBranch<K>): FilterEntity<K> {
  const ex = entity.export
  return {
    ...entity,
    root: b.root,
    alias: b.alias,
    pk: b.pk,
    base: b.base,
    sql: b.sql,
    search: entity.search && { param: entity.search.param, build: b.search ?? NO_MATCH },
    export: ex && {
      ...ex,
      columns: ex.columns.map(c => ({ ...c, sql: b.export?.columns[c.key] ?? 'NULL' })),
      keyset: b.export?.keyset ?? ex.keyset,
    },
    branches: undefined,
  }
}

/** The entity as each of its UNION tables (just itself when it has none). */
export function branchesOf<K extends string>(entity: FilterEntity<K>): FilterEntity<K>[] {
  return entity.branches?.length ? entity.branches.map(b => branchView(entity, b)) : [entity]
}

/** One branch of a UNION entity; the entity itself when it has no such branch. */
export function branchOf<K extends string>(entity: FilterEntity<K>, key?: string): FilterEntity<K> {
  const b = key ? entity.branches?.find(x => x.key === key) : undefined
  return b ? branchView(entity, b) : entity
}

/** A UNION entity: the top-level root, alias, SQL and search mirror the first branch. */
export function unionEntity<K extends string>(
  e: Omit<FilterEntity<K>, 'root' | 'alias' | 'pk' | 'base' | 'sql' | 'search' | 'branches'> & {
    search?: { param?: string }
    branches: [FilterBranch<K>, ...FilterBranch<K>[]]
  }
): FilterEntity<K> {
  const first = e.branches[0]
  return {
    ...e,
    root: first.root,
    alias: first.alias,
    pk: first.pk,
    base: first.base,
    sql: first.sql,
    search: e.search && { param: e.search.param, build: first.search ?? NO_MATCH },
  }
}

/** WHERE conditions for the active fields, binding from `startIdx` (the product builder's contract). */
export function buildClauses<K extends string>(
  entity: FilterEntity<K>,
  q: FilterQuery,
  startIdx: number,
  opts: ClauseOpts = {}
): Clauses {
  if (opts.branch && entity.branches)
    return buildClauses(branchOf(entity, opts.branch), q, startIdx, { ...opts, branch: undefined })
  const conditions: string[] = []
  const params: unknown[] = []
  const bind: Bind = value => {
    params.push(value)
    return `$${startIdx + params.length - 1}`
  }
  if (entity.custom) return opts.only ? { conditions, params, nextIdx: startIdx } : entity.custom.clauses(q, startIdx)
  for (const f of entity.fields) {
    if (opts.omit?.includes(f.key) || (opts.only && !opts.only.includes(f.key))) continue
    conditions.push(...fieldConditions(f, entity.sql[f.key], q, bind, opts.ctx ?? {}))
  }
  return { conditions, params, nextIdx: startIdx + params.length }
}

/** Base conditions, then search, then fields. `where` is '' when there is nothing to filter. */
export function buildWhere<K extends string>(
  entity: FilterEntity<K>,
  q: FilterQuery,
  startIdx = 1,
  opts: ClauseOpts & { base?: boolean } = {}
): Clauses & { where: string } {
  if (opts.branch && entity.branches)
    return buildWhere(branchOf(entity, opts.branch), q, startIdx, { ...opts, branch: undefined })
  const conditions = opts.base === false ? [] : [...(entity.base ?? [])]
  const params: unknown[] = []
  let idx = startIdx
  // Never skipped (unlike `base`): these carry tenant scoping.
  for (const b of entity.boundBase ?? []) conditions.push(sqlOf(b, opts.ctx ?? {}, v => (params.push(v), `$${idx++}`)))
  const sp = searchParamOf(entity as FilterEntity)
  const term = entity.search && !opts.omit?.includes(sp) && !opts.only ? q[sp] : undefined
  if (term && entity.search) {
    const sc = entity.search.build(term, idx)
    conditions.push(sc.clause)
    params.push(...sc.params)
    idx = sc.nextIdx
  }
  const c = buildClauses(entity, q, idx, opts)
  conditions.push(...c.conditions)
  params.push(...c.params)
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', conditions, params, nextIdx: c.nextIdx }
}

/** True when any field (or the search) outside `omit` is set. */
export function hasFilters<K extends string>(entity: FilterEntity<K>, q: FilterQuery, omit: string[] = []): boolean {
  const sp = searchParamOf(entity as FilterEntity)
  if (entity.search && q[sp] && !omit.includes(sp)) return true
  if (entity.custom) return entity.custom.clauses(q, 1).conditions.length > 0
  return entity.fields.some(f => !omit.includes(f.key) && paramNamesOf(f).some(n => !!q[n]))
}

/** The filters as fragments an overview appends after its own args; empty adds nothing at all. */
export function filterScope<K extends string>(
  entity: FilterEntity<K>,
  q: FilterQuery,
  opts: ClauseOpts = {}
): FilterScope {
  const empty = !hasFilters(entity, q, opts.omit)
  return {
    empty,
    and(start, branch) {
      if (empty) return { sql: '', params: [] }
      const w = buildWhere(entity, q, start, { ...opts, base: false, branch: branch ?? opts.branch })
      return { sql: w.conditions.map(c => ` AND ${c}`).join(''), params: w.params }
    },
    inIds(col, start) {
      if (empty) return { sql: '', params: [] }
      const params: unknown[] = []
      const sel = branchesOf(entity).map(b => {
        const w = buildWhere(b, q, start + params.length, { ...opts, branch: undefined })
        params.push(...w.params)
        return `SELECT ${b.alias}.${b.pk ?? 'id'} FROM ${b.root} ${b.alias} ${w.where}`
      })
      return { sql: ` AND ${col} IN (${sel.join(' UNION ALL ')})`, params }
    },
  }
}

/** Matching rows counted up to `cap` (one past it tells the caller the count was capped). */
export function countQuery<K extends string>(
  entity: FilterEntity<K>,
  q: FilterQuery,
  cap: number,
  opts: ClauseOpts = {}
): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const sel = branchesOf(entity).map(b => {
    const w = buildWhere(b, q, params.length + 1, { ...opts, branch: undefined })
    params.push(...w.params)
    return `SELECT 1 FROM ${b.root} ${b.alias} ${w.where}`
  })
  return { sql: `SELECT count(*)::int AS n FROM (${sel.join(' UNION ALL ')} LIMIT ${cap + 1}) t`, params }
}
