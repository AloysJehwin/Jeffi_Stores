import { MAX_VALUE_LENGTH, escapeLike } from './client'
import { buildWhere, rowsSql } from './clauses'
import type { FilterCtx, FilterEntity, FilterQuery } from './types'

export const VALUES_PAGE_SIZE = 50

export interface FilterValue {
  value: string
  count: number
}

/** True when `field` is a value-help field of the entity. */
export function isValuesField<K extends string>(entity: FilterEntity<K>, field: string): field is K {
  return Object.hasOwn(entity.sql, field) && entity.sql[field as K].kind === 'values'
}

/**
 * Distinct values of one field with their row counts, busiest first. With `facets`, the other active
 * filters narrow the counts. Fetches one extra row so the caller can tell whether there is more.
 */
export function valuesQuery<K extends string>(
  entity: FilterEntity<K>,
  field: string,
  q: FilterQuery,
  opts: { search?: string; page?: number; ctx?: FilterCtx; pageSize?: number } = {}
): { sql: string; params: unknown[]; pageSize: number } | null {
  if (!isValuesField(entity, field)) return null
  const s = entity.sql[field]
  if (s.kind !== 'values') return null
  const pageSize = opts.pageSize ?? VALUES_PAGE_SIZE
  const w = entity.facets ? buildWhere(entity, q, 1, { omit: [field], ctx: opts.ctx }) : buildWhere(entity, {}, 1)
  const params = [...w.params]
  const bind = (v: unknown) => {
    params.push(v)
    return `$${params.length}`
  }
  const fold = s.fold ?? 'lower'
  const conds = [...w.conditions, `v.val IS NOT NULL`, `v.val <> ''`]
  const needle = (opts.search ?? '').trim().slice(0, MAX_VALUE_LENGTH)
  if (needle) conds.push(`v.val ILIKE ${bind(`%${escapeLike(needle)}%`)}`)
  const offset = bind((Math.max(1, opts.page ?? 1) - 1) * pageSize)
  const a = entity.alias
  const sql = `SELECT mode() WITHIN GROUP (ORDER BY v.val) AS value, count(DISTINCT ${a}.${entity.pk ?? 'id'})::int AS count
     FROM ${entity.root} ${a} CROSS JOIN LATERAL (${rowsSql(s)}) v
     WHERE ${conds.join(' AND ')}
     GROUP BY ${fold}(v.val)
     ORDER BY count DESC, value
     LIMIT ${pageSize + 1} OFFSET ${offset}`
  return { sql, params, pageSize }
}

/** Trims the look-ahead row. */
export function pageOfValues(
  rows: FilterValue[],
  pageSize = VALUES_PAGE_SIZE
): { values: FilterValue[]; hasMore: boolean } {
  return { values: rows.slice(0, pageSize), hasMore: rows.length > pageSize }
}
