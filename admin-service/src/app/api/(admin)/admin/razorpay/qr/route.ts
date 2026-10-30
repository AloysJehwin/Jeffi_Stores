import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { createOrderUpiQr } from '@/lib/payments/upi-qr'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { orderId, amountPaise, description } = await request.json()
    if (!orderId || !amountPaise)
      return NextResponse.json({ error: 'orderId and amountPaise required' }, { status: 400 })

    const order = await queryOne<{ id: string; order_number: string }>(
      'SELECT id, order_number FROM orders WHERE id = $1',
      [orderId]
    )
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const { qrId, qrImageUrl } = await createOrderUpiQr({
      order,
      amountPaise,
      name: description || 'Invoice Payment',
      description: description || `${await currentBrandNameAsync()} Invoice`,
    })
    return NextResponse.json({ qrId, qrImageUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
