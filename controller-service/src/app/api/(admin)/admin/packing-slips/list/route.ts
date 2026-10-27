import { NextRequest, NextResponse } from 'next/server'
import { buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { queryMany } from '@/lib/shared/db'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { PACKING_ENTITY } from '@/lib/filters/entities/packing-slips'

// awb_number / invoice_number / digital_only say which documents the row can offer.
const COLUMNS = `o.id, o.order_number, o.customer_name, o.created_at, o.status, o.total_amount,
  o.awb_number, o.invoice_number,
  (EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.is_digital)
   AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.is_digital IS NOT TRUE)) AS digital_only`

// The slips list: the list filters (from / to are the order date); without dates or a search, the
// last 30 days. page + pageSize pages and adds `total`; without pageSize, up to 500 rows.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'packing_slips:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const q = normalizeQuery(PACKING_ENTITY, searchParams)
  const w = buildWhere(PACKING_ENTITY, q, 1, { ctx: (await PACKING_ENTITY.context?.(q)) ?? {} })
  const params = w.params
  const windowed = !q.from && !q.to && !q.search
  const conds = windowed
    ? [`o.created_at >= NOW() - INTERVAL '${PACKING_ENTITY.defaultWindowDays} days'`, ...w.conditions]
    : w.conditions
  const where = `WHERE ${conds.join(' AND ')}`

  const pageSizeRaw = searchParams.get('pageSize')
  if (!pageSizeRaw) {
    const orders = await queryMany(
      `SELECT ${COLUMNS}
       FROM orders o
       ${where}
       ORDER BY o.created_at DESC
       LIMIT 500`,
      params
    )
    return NextResponse.json({ orders: orders || [] })
  }

  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeRaw, 10) || 25))
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const [orders, count] = await Promise.all([
    queryMany(
      `SELECT ${COLUMNS}
       FROM orders o
       ${where}
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    queryMany<{ n: string }>(`SELECT COUNT(*)::text AS n FROM orders o ${where}`, params),
  ])
  return NextResponse.json({
    orders: orders || [],
    total: Number(count?.[0]?.n || 0),
    page,
    pageSize,
    windowDays: windowed ? PACKING_ENTITY.defaultWindowDays : null,
  })
}
