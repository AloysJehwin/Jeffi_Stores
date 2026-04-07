import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany, query } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { sendOrderStatusUpdate } from '@/lib/email'

const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing']

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

    // Fetch order — must belong to the authenticated user
    const order = await queryOne(`
      SELECT o.id, o.order_number, o.status, o.payment_status, o.user_id, o.customer_name, o.customer_email,
        json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1 AND o.user_id = $2
    `, [orderId, authUser.userId])

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      return NextResponse.json(
        { error: `Cancellation cannot be requested — current status is "${order.status}"` },
        { status: 400 }
      )
    }

    // If order is pending + unpaid, cancel immediately and restore stock
    if (order.status === 'pending' && order.payment_status === 'unpaid') {
      const orderItems = await queryMany(
        'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1',
        [orderId]
      )
      for (const item of orderItems) {
        if (item.variant_id) {
          await query(
            'UPDATE product_variants SET stock_quantity = stock_quantity + $1 WHERE id = $2',
            [item.quantity, item.variant_id]
          )
        } else {
          await query(
            'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
            [item.quantity, item.product_id]
          )
        }
      }
      await query(
        `UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [orderId]
      )
      return NextResponse.json({ success: true, directCancel: true })
    }

    // Otherwise, set status to cancel_requested (admin will approve/reject)
    await query(
      `UPDATE orders SET status = 'cancel_requested', updated_at = NOW() WHERE id = $1`,
      [orderId]
    )

    // Send notification email (fire-and-forget)
    const user = order.users
    const userEmail = user?.email || order.customer_email
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : order.customer_name

    if (userEmail && userName) {
      sendOrderStatusUpdate(
        userEmail,
        userName,
        order.order_number,
        orderId,
        'cancel_requested',
        order.status
      ).catch(err => console.error('Failed to send cancellation request email:', err))
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Order cancellation request error:', error)
    return NextResponse.json({ error: 'Failed to request cancellation' }, { status: 500 })
  }
}
