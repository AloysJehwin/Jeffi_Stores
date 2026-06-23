import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query } from '@/lib/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { sendPaymentStatusUpdate, sendPaymentFailedAdminNotification } from '@/lib/email'
import { createAutoTask } from '@/lib/auto-tasks'
import { logActivity } from '@/lib/activity'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = id
    const body = await request.json().catch(() => ({}))
    const errorDescription = body?.errorDescription || ''

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

    if (order.payment_status === 'paid' || order.status === 'cancelled') {
      return NextResponse.json({ success: true })
    }

    await query(
      `UPDATE payments SET status = 'failed', updated_at = NOW()
       WHERE order_id = $1 AND status = 'pending'`,
      [orderId]
    )

    await query(
      `UPDATE orders SET payment_status = 'failed', updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [orderId]
    )

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
      ).catch(() => {})
    }

    sendPaymentFailedAdminNotification(order, errorDescription).catch(() => {})

    createAutoTask({
      userId: authUser.userId,
      sourceKind: 'contact_failed_payment',
      sourceRefId: orderId,
      title: `Reach out about failed payment on #${order.order_number}`,
      description: `Payment failed for ₹${order.total_amount}.${errorDescription ? ` Reason: ${errorDescription}` : ''}`,
      priority: 'medium',
      dueInDays: 1,
    }).catch(() => {})

    logActivity({
      userId: authUser.userId,
      kind: 'payment_status',
      referenceId: orderId,
      referenceType: 'orders',
      summary: `Payment failed for #${order.order_number}${errorDescription ? `: ${errorDescription}` : ''}`,
      metadata: { payment_status: 'failed', error: errorDescription },
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed to record payment failure' }, { status: 500 })
  }
}
