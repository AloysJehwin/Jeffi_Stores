import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const { payment_status } = body

    const allowed = ['unpaid', 'paid', 'partial', 'refunded']
    if (!allowed.includes(payment_status)) {
      return NextResponse.json({ error: 'Invalid payment_status' }, { status: 400 })
    }

    const order = await queryOne<{ id: string }>('SELECT id FROM orders WHERE id = $1', [id])
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    await query('UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2', [payment_status, id])

    return NextResponse.json({ success: true, payment_status })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
