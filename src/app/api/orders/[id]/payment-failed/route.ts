import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { sendPaymentStatusUpdate, sendPaymentFailedAdminNotification } from '@/lib/email'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = params.id
    const body = await request.json().catch(() => ({}))
    const errorDescription = body?.errorDescription || ''

    // Fetch order — must belong to the authenticated user
    const order = await queryOne(`
      SELECT o.id, o.order_number, o.status, o.payment_status, o.total_amount,
        o.customer_name, o.customer_email, o.customer_phone,
        json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1 AND o.user_id = $2
    `, [orderId, authUser.userId])

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Don't process if already paid or cancelled
    if (order.payment_status === 'paid' || order.status === 'cancelled') {
      return NextResponse.json({ success: true })
    }

    // Update payment record to failed
    await query(
      `UPDATE payments SET status = 'failed', updated_at = NOW()
       WHERE order_id = $1 AND status = 'pending'`,
      [orderId]
    )

    // Update order payment status to failed
    await query(
      `UPDATE orders SET payment_status = 'failed', updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [orderId]
    )

    // Send emails (fire-and-forget)
    const user = order.users
    const userEmail = user?.email || order.customer_email
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : order.customer_name

    if (userEmail && userName) {
      sendPaymentStatusUpdate(
        userEmail,
        userName,
        order.order_number,
        orderId,
        'failed',
        parseFloat(order.total_amount)
      ).catch(err => console.error('Failed to send payment failed email:', err))
    }

    sendPaymentFailedAdminNotification(order, errorDescription)
      .catch(err => console.error('Failed to send admin payment failed notification:', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Payment failed recording error:', error)
    return NextResponse.json({ error: 'Failed to record payment failure' }, { status: 500 })
  }
}
