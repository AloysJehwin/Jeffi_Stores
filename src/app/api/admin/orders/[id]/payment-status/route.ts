import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { payment_status } = body

    const allowed = ['unpaid', 'paid', 'partial', 'refunded']
    if (!allowed.includes(payment_status)) {
      return NextResponse.json({ error: 'Invalid payment_status' }, { status: 400 })
    }

    const order = await queryOne<{ id: string }>('SELECT id FROM orders WHERE id = $1', [params.id])
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    await query(
      'UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2',
      [payment_status, params.id]
    )

    return NextResponse.json({ success: true, payment_status })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
