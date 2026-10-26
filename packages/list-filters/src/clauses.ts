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
import type {
  Bind,
  ClauseOpts,
  Clauses,
  FieldSql,
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

/** WHERE conditions for the active fields, binding from `startIdx` (the product builder's contract). */
export function buildClauses<K extends string>(
  entity: FilterEntity<K>,
  q: FilterQuery,
  startIdx: number,
  opts: ClauseOpts = {}
): Clauses {
  const conditions: string[] = []
  const params: unknown[] = []
  const bind: Bind = value => {
    params.push(value)
    return `$${startIdx + params.length - 1}`
  }
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
  const conditions = opts.base === false ? [] : [...(entity.base ?? [])]
  const params: unknown[] = []
  let idx = startIdx
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
  return entity.fields.some(f => !omit.includes(f.key) && paramNamesOf(f).some(n => !!q[n]))
}

/** The filters as fragments an overview appends after its own args; empty adds nothing at all. */
export function filterScope<K extends string>(
  entity: FilterEntity<K>,
  q: FilterQuery,
  opts: ClauseOpts = {}
): FilterScope {
  const empty = !hasFilters(entity, q, opts.omit)
  const pk = entity.pk ?? 'id'
  return {
    empty,
    and(start) {
      if (empty) return { sql: '', params: [] }
      const w = buildWhere(entity, q, start, { ...opts, base: false })
      return { sql: w.conditions.map(c => ` AND ${c}`).join(''), params: w.params }
    },
    inIds(col, start) {
      if (empty) return { sql: '', params: [] }
      const w = buildWhere(entity, q, start, opts)
      return {
        sql: ` AND ${col} IN (SELECT ${entity.alias}.${pk} FROM ${entity.root} ${entity.alias} ${w.where})`,
        params: w.params,
      }
    },
  }
}
