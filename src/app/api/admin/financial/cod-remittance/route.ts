import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || 'cod_collected' // cod_pending | cod_collected | paid

  const orders = await queryMany(
    `SELECT o.id, o.order_number, o.customer_name, o.customer_email,
            o.total_amount, o.payment_status, o.payment_mode,
            o.delivered_at, o.cod_remitted_at, o.updated_at,
            o.status AS order_status
     FROM orders o
     WHERE o.payment_mode = 'cod'
       AND ($1 = 'all' OR o.payment_status = $1)
     ORDER BY o.delivered_at DESC NULLS LAST, o.updated_at DESC
     LIMIT 500`,
    [status]
  )

  // Group cod_collected by delivery week
  const weeks: Record<string, { weekLabel: string; weekStart: string; orders: any[]; total: number }> = {}
  for (const o of orders) {
    if (o.payment_status === 'cod_collected' && o.delivered_at) {
      const d = new Date(o.delivered_at)
      // Monday of delivery week
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const mon = new Date(d.setDate(diff))
      const weekStart = mon.toISOString().slice(0, 10)
      if (!weeks[weekStart]) {
        weeks[weekStart] = {
          weekLabel: `Week of ${mon.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
          weekStart,
          orders: [],
          total: 0,
        }
      }
      weeks[weekStart].orders.push(o)
      weeks[weekStart].total += parseFloat(o.total_amount)
    }
  }

  const summary = {
    cod_pending: orders.filter(o => o.payment_status === 'cod_pending').length,
    cod_collected: orders.filter(o => o.payment_status === 'cod_collected').length,
    cod_collected_amount: orders
      .filter(o => o.payment_status === 'cod_collected')
      .reduce((s, o) => s + parseFloat(o.total_amount), 0),
  }

  return NextResponse.json({ orders, weeks: Object.values(weeks).sort((a, b) => b.weekStart.localeCompare(a.weekStart)), summary })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { orderIds } = body

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds required' }, { status: 400 })
  }

  await query(
    `UPDATE orders
     SET payment_status = 'paid', cod_remitted_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::uuid[]) AND payment_mode = 'cod' AND payment_status = 'cod_collected'`,
    [orderIds]
  )

  return NextResponse.json({ success: true, marked: orderIds.length })
}
