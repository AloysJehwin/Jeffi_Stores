import { branchesOf, buildWhere } from './clauses'
import type { FilterCtx, FilterEntity, FilterQuery } from './types'

export const EXPORT_BATCH = 1000
export const EXPORT_CAP = 50_000
export const CSV_BOM = '\uFEFF'

/**
 * One keyset batch of the export: the entity's columns plus the keyset values (`__k0`, `__k1`, …,
 * as text so timestamps keep their microseconds) the next batch passes back as `after`. Null when
 * the entity has no export.
 */
export function exportQuery<K extends string>(
  entity: FilterEntity<K>,
  q: FilterQuery,
  opts: { after?: unknown[]; limit?: number; ctx?: FilterCtx } = {}
): { sql: string; params: unknown[] } | null {
  const ex = entity.export
  if (!ex?.columns.length || !ex.keyset.length) return null
  if (entity.branches?.length) return unionExportQuery(entity, q, opts)
  const w = buildWhere(entity, q, 1, { ctx: opts.ctx })
  const params = [...w.params]
  const conds = [...w.conditions]
  if (opts.after?.length === ex.keyset.length) {
    const binds = opts.after.map(v => {
      params.push(v)
      return `$${params.length}`
    })
    conds.push(`(${ex.keyset.join(', ')}) > (${binds.join(', ')})`)
  }
  const cols = [...ex.columns.map(c => `${c.sql} AS "${c.key}"`), ...ex.keyset.map((k, i) => `(${k})::text AS "__k${i}"`)]
  const sql = `SELECT ${cols.join(', ')}
     FROM ${entity.root} ${entity.alias}
     ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
     ORDER BY ${ex.keyset.join(', ')}
     LIMIT ${Math.max(1, opts.limit ?? EXPORT_BATCH)}`
  return { sql, params }
}

/** Each branch filtered and keyset-bounded on its own, merged and ordered on the output keys. */
function unionExportQuery<K extends string>(
  entity: FilterEntity<K>,
  q: FilterQuery,
  opts: { after?: unknown[]; limit?: number; ctx?: FilterCtx }
): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const bind = (v: unknown) => {
    params.push(v)
    return `$${params.length}`
  }
  const keys = (entity.export?.keyset ?? []).map((_, i) => `"__k${i}"`)
  const parts = branchesOf(entity).map(b => {
    const ex = b.export ?? { columns: [], keyset: [] }
    const w = buildWhere(b, q, params.length + 1, { ctx: opts.ctx })
    params.push(...w.params)
    const conds = [...w.conditions]
    if (opts.after?.length === ex.keyset.length)
      conds.push(`(${ex.keyset.join(', ')}) > (${opts.after.map(bind).join(', ')})`)
    const cols = [...ex.columns.map(c => `${c.sql} AS "${c.key}"`), ...ex.keyset.map((k, i) => `${k} AS ${keys[i]}`)]
    return `(SELECT ${cols.join(', ')} FROM ${b.root} ${b.alias}${conds.length ? ` WHERE ${conds.join(' AND ')}` : ''})`
  })
  const sql = `SELECT * FROM (${parts.join(' UNION ALL ')}) u
     ORDER BY ${keys.join(', ')}
     LIMIT ${Math.max(1, opts.limit ?? EXPORT_BATCH)}`
  return { sql, params }
}

/** A CSV cell: formula-leading values (not plain negative numbers) neutralised with `'`, quoted when needed. */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(cells: unknown[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`
}
