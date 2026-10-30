import type { PoolClient } from 'pg'
import {
  CSV_BOM,
  EXPORT_BATCH,
  countQuery,
  csvRow,
  exportQuery,
  pageOfValues,
  valuesQuery,
  type FilterCtx,
  type FilterEntity,
  type FilterQuery,
  type FilterValue,
} from '@jeffi/list-filters'
import { withTransaction } from '@/lib/shared/db'
import { resolveTenant, runWithTenantContext } from '@/lib/tenancy/tenant-context'

// Runs filter queries for the registry: value help under a short statement timeout, capped counts,
// a first page of rows (the admin agent), CSV export.

const VALUES_TIMEOUT = '4s'
const EXPORT_TIMEOUT = '15s'

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
  if (entity.custom) return entity.custom.values ? entity.custom.values(field, opts) : null
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
  const cq = countQuery(entity, q, cap, { ctx: ctx ?? (await filterContext(entity, q)) })
  const r = await withTimeout(entity.db, '15s', c => c.query<{ n: number }>(cq.sql, cq.params))
  const n = r.rows[0]?.n ?? 0
  return { count: Math.min(n, cap), capped: n > cap }
}

/** The first `limit` rows the filters match (the export columns), with the count up to `cap`. */
export async function listRows(
  entity: FilterEntity,
  q: FilterQuery,
  limit: number,
  cap = 10_000
): Promise<{ count: number; capped: boolean; rows: Record<string, unknown>[] }> {
  const ctx = await filterContext(entity, q)
  const eq = exportQuery(entity, q, { limit, ctx })
  if (!eq) throw new Error(`${entity.key} has no export`)
  const [rows, total] = await Promise.all([
    withTimeout(entity.db, EXPORT_TIMEOUT, c => c.query<Record<string, unknown>>(eq.sql, eq.params).then(r => r.rows)),
    cappedCount(entity, q, cap, ctx),
  ])
  // Keyset columns (__k0…) are paging internals; the last one is the row's id on almost every list.
  const ks = entity.export!.keyset
  const idKey = /(^|\.)id$/.test(ks[ks.length - 1]) ? `__k${ks.length - 1}` : null
  return {
    ...total,
    rows: rows.map(r => ({
      ...(idKey && r[idKey] != null ? { id: String(r[idKey]) } : {}),
      ...Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('__'))),
    })),
  }
}

/**
 * The filtered rows as CSV: BOM and header, then keyset batches of 1,000 up to `cap`, each its own
 * pooled query under a statement timeout. The tenant is captured here because the stream is pulled
 * after the handler returns. `onDone(rows, completed)` runs once, when it ends or is cancelled.
 */
export async function streamCsv(
  entity: FilterEntity,
  q: FilterQuery,
  opts: { cap: number; ctx?: FilterCtx; onDone?: (rows: number, completed: boolean) => unknown }
): Promise<ReadableStream<Uint8Array>> {
  const ex = entity.export
  if (!ex) throw new Error(`${entity.key} has no export`)
  const ctx = opts.ctx ?? (await filterContext(entity, q))
  const tenant = await resolveTenant()
  const inTenant = <T>(fn: () => Promise<T>) => (tenant ? runWithTenantContext(tenant, fn) : fn())
  const enc = new TextEncoder()
  let after: unknown[] | undefined
  let rows = 0
  let ended = false
  const end = async (completed: boolean) => {
    if (ended) return
    ended = true
    await inTenant(async () => opts.onDone?.(rows, completed))
  }

  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(CSV_BOM + csvRow(ex.columns.map(col => col.label))))
    },
    async pull(c) {
      try {
        const limit = Math.min(EXPORT_BATCH, opts.cap - rows)
        const eq = limit > 0 ? exportQuery(entity, q, { after, limit, ctx }) : null
        const batch = eq
          ? await inTenant(() =>
              withTimeout(entity.db, EXPORT_TIMEOUT, cl =>
                cl.query<Record<string, unknown>>(eq.sql, eq.params).then(r => r.rows)
              )
            )
          : []
        if (batch.length) {
          c.enqueue(enc.encode(batch.map(r => csvRow(ex.columns.map(col => r[col.key]))).join('')))
          rows += batch.length
          const last = batch[batch.length - 1]
          after = ex.keyset.map((_, i) => last[`__k${i}`])
        }
        if (batch.length < limit || rows >= opts.cap) {
          c.close()
          await end(true)
        }
      } catch (err) {
        console.error(`[filters/${entity.key}/export]`, err)
        c.error(err)
        await end(false)
      }
    },
    async cancel() {
      await end(false)
    },
  })
}
