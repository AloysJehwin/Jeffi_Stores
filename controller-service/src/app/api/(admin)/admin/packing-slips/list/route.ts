import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'packing_slips:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const params: any[] = []
  let where = ''

  if (from && to) {
    params.push(from, to)
    where = `WHERE o.created_at >= $1::date AND o.created_at < ($2::date + INTERVAL '1 day')`
  } else if (from) {
    params.push(from)
    where = `WHERE o.created_at >= $1::date`
  } else if (to) {
    params.push(to)
    where = `WHERE o.created_at < ($1::date + INTERVAL '1 day')`
  } else {
    where = `WHERE o.created_at >= NOW() - INTERVAL '30 days'`
  }

  // Optional, additive: customer/status filters and page/pageSize paging (adds `total`).
  const customer = searchParams.get('customer')?.trim()
  const status = searchParams.get('status')?.trim()
  if (customer) {
    params.push(`%${customer}%`)
    where += ` AND o.customer_name ILIKE $${params.length}`
  }
  if (status) {
    params.push(status)
    where += ` AND o.status = $${params.length}`
  }
  where += ` AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.is_digital IS NOT TRUE)`

  const pageSizeRaw = searchParams.get('pageSize')
  if (!pageSizeRaw) {
    const orders = await queryMany(
      `SELECT o.id, o.order_number, o.customer_name, o.created_at, o.status, o.total_amount
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
      `SELECT o.id, o.order_number, o.customer_name, o.created_at, o.status, o.total_amount
       FROM orders o
       ${where}
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    queryMany<{ n: string }>(`SELECT COUNT(*)::text AS n FROM orders o ${where}`, params),
  ])
  return NextResponse.json({ orders: orders || [], total: Number(count?.[0]?.n || 0), page, pageSize })
}
