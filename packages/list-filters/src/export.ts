import { buildWhere } from './clauses'
import type { FilterCtx, FilterEntity, FilterQuery } from './types'

export const EXPORT_BATCH = 1000
export const EXPORT_CAP = 50_000
export const CSV_BOM = '\uFEFF'

/**
 * One keyset batch of the export: the entity's columns plus the keyset values (`__k0`, `__k1`, …)
 * the next batch passes back as `after`. Null when the entity has no export.
 */
export function exportQuery<K extends string>(
  entity: FilterEntity<K>,
  q: FilterQuery,
  opts: { after?: unknown[]; limit?: number; ctx?: FilterCtx } = {}
): { sql: string; params: unknown[] } | null {
  const ex = entity.export
  if (!ex?.columns.length || !ex.keyset.length) return null
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
  const cols = [...ex.columns.map(c => `${c.sql} AS "${c.key}"`), ...ex.keyset.map((k, i) => `${k} AS "__k${i}"`)]
  const sql = `SELECT ${cols.join(', ')}
     FROM ${entity.root} ${entity.alias}
     ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
     ORDER BY ${ex.keyset.join(', ')}
     LIMIT ${Math.max(1, opts.limit ?? EXPORT_BATCH)}`
  return { sql, params }
}

/** A CSV cell: formula-leading values neutralised with `'`, quoted when needed. */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(cells: unknown[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`
}
