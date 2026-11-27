import 'server-only'
import { sortClause, type SortDef } from '@jeffi/list-filters'
import { queryMany } from '@/lib/shared/db'

const SORT: SortDef = {
  sorts: { category: 'category_name', pct: 'percentage', products: 'product_count', applied_by: 'applied_by', applied_at: 'applied_at' },
  defaultSql: 'applied_at DESC',
  tiebreak: 'id DESC',
}

const COLS = `id, category_id, category_name, percentage, applied_fields, product_count, applied_by, applied_at, snapshot, is_rollback, rolled_back_at, rolled_back_by`

/**
 * The price inflation log, newest first: the Inflation page's history and its API. With ?limit (+ ?offset,
 * ?sort&dir) it pages the log and returns the total; without them, the latest 100.
 */
export async function inflationLogs(sp: URLSearchParams): Promise<{ logs: any[]; total?: number }> {
  const limit = Math.min(100, Math.max(0, parseInt(sp.get('limit') || '0', 10) || 0))
  if (limit > 0) {
    const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0)
    const [logs, count] = await Promise.all([
      queryMany(`SELECT ${COLS} FROM price_inflation_log ${sortClause(sp, SORT)} LIMIT $1 OFFSET $2`, [limit, offset]),
      queryMany<{ n: string }>(`SELECT COUNT(*)::text AS n FROM price_inflation_log`, []),
    ])
    return { logs: logs || [], total: Number(count?.[0]?.n ?? 0) }
  }

  const logs = await queryMany(
    `SELECT ${COLS}
     FROM price_inflation_log
     ORDER BY applied_at DESC
     LIMIT 100`,
    []
  )

  return { logs: logs || [] }
}
