import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { restoreOrderStock } from '@/lib/orders/order-stock'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(
      `SELECT id, order_number, status, payment_status, source FROM orders WHERE id = $1`,
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.source !== 'offline') {
      return NextResponse.json({ error: 'Only offline invoices can be cancelled from here' }, { status: 400 })
    }
    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'Invoice is already cancelled' }, { status: 400 })
    }

    await restoreOrderStock(id)

    await query(
      `UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id]
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to cancel invoice' }, { status: 500 })
  }
}
