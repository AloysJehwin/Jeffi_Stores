import type { PoolClient } from 'pg'
import {
  buildWhere,
  pageOfValues,
  valuesQuery,
  type FilterCtx,
  type FilterEntity,
  type FilterQuery,
  type FilterValue,
} from '@jeffi/list-filters'
import { withTransaction } from '@/lib/shared/db'

// Runs filter queries for the registry: value help under a short statement timeout, capped counts.

const VALUES_TIMEOUT = '4s'

/** One transaction on the entity's DB with a local statement timeout. */
async function withTimeout<T>(db: FilterEntity['db'], timeout: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const run = async (c: PoolClient) => {
    await c.query(`SET LOCAL statement_timeout = '${timeout}'`)
    return fn(c)
  }
  if (db !== 'control') return withTransaction(run)
  const { controlPlanePool } = await import('@/lib/tenant-registry')
  const c = await controlPlanePool().connect()
  try {
    await c.query('BEGIN')
    const out = await run(c)
    await c.query('COMMIT')
    return out
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    c.release()
  }
}

export async function filterContext(entity: FilterEntity, q: FilterQuery): Promise<FilterCtx> {
  return entity.context ? entity.context(q) : {}
}

/** One page of a value-help field's values with counts; null for a field without value help. */
export async function getFilterValues(
  entity: FilterEntity,
  field: string,
  q: FilterQuery,
  opts: { search?: string; page?: number } = {}
): Promise<{ values: FilterValue[]; hasMore: boolean } | null> {
  const ctx = await filterContext(entity, q)
  const vq = valuesQuery(entity, field, q, { ...opts, ctx })
  if (!vq) return null
  const rows = await withTimeout(entity.db, VALUES_TIMEOUT, c =>
    c.query<FilterValue>(vq.sql, vq.params).then(r => r.rows)
  )
  return pageOfValues(rows, vq.pageSize)
}

/** Matching rows, counted up to `cap` (logs and the ledger never count a whole table). */
export async function cappedCount(
  entity: FilterEntity,
  q: FilterQuery,
  cap: number,
  ctx?: FilterCtx
): Promise<{ count: number; capped: boolean }> {
  const w = buildWhere(entity, q, 1, { ctx: ctx ?? (await filterContext(entity, q)) })
  const r = await withTimeout(entity.db, '15s', c =>
    c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT 1 FROM ${entity.root} ${entity.alias} ${w.where} LIMIT ${cap + 1}) t`,
      w.params
    )
  )
  const n = r.rows[0]?.n ?? 0
  return { count: Math.min(n, cap), capped: n > cap }
}
