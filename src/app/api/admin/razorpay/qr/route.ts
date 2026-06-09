import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import { getRazorpayInstance } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { orderId, amountPaise, description } = await request.json()
    if (!orderId || !amountPaise) return NextResponse.json({ error: 'orderId and amountPaise required' }, { status: 400 })

    const order = await queryOne<{ id: string }>('SELECT id FROM orders WHERE id = $1', [orderId])
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const rzp = getRazorpayInstance() as any
    const closeBy = Math.floor(Date.now() / 1000) + 24 * 60 * 60 // 24 hours

    const qr = await rzp.qrCode.create({
      type: 'upi_qr',
      name: description || 'Invoice Payment',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: amountPaise,
      description: description || 'Jeffi Stores Invoice',
      close_by: closeBy,
    })

    await query(
      `UPDATE orders SET razorpay_qr_id = $1, razorpay_qr_image_url = $2, updated_at = NOW() WHERE id = $3`,
      [qr.id, qr.image_url, orderId]
    )

    return NextResponse.json({ qrId: qr.id, qrImageUrl: qr.image_url })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
