import { NextRequest, NextResponse } from 'next/server'
import { sortClause, type SortDef } from '@jeffi/list-filters'
import { queryMany } from '@/lib/shared/db'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'

const SORT: SortDef = {
  sorts: { category: 'category_name', pct: 'percentage', products: 'product_count', applied_by: 'applied_by', applied_at: 'applied_at' },
  defaultSql: 'applied_at DESC',
  tiebreak: 'id DESC',
}

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inflation:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const cols = `id, category_id, category_name, percentage, applied_fields, product_count, applied_by, applied_at, snapshot, is_rollback, rolled_back_at, rolled_back_by`
  // Optional ?limit&offset (+ ?sort&dir) pages the log (with a total); without them, the latest 100 as before.
  const sp = request.nextUrl.searchParams
  const limit = Math.min(100, Math.max(0, parseInt(sp.get('limit') || '0', 10) || 0))
  if (limit > 0) {
    const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0)
    const [logs, count] = await Promise.all([
      queryMany(`SELECT ${cols} FROM price_inflation_log ${sortClause(sp, SORT)} LIMIT $1 OFFSET $2`, [limit, offset]),
      queryMany<{ n: string }>(`SELECT COUNT(*)::text AS n FROM price_inflation_log`, []),
    ])
    return NextResponse.json({ logs: logs || [], total: Number(count?.[0]?.n ?? 0) })
  }

  const logs = await queryMany(
    `SELECT ${cols}
     FROM price_inflation_log
     ORDER BY applied_at DESC
     LIMIT 100`,
    []
  )

  return NextResponse.json({ logs: logs || [] })
}
