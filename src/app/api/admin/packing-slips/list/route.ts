import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'packing_slips')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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
