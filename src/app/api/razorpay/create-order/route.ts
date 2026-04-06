import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { getRazorpayInstance, isRazorpayEnabled } from '@/lib/razorpay'

export async function POST(request: NextRequest) {
  try {
    if (!isRazorpayEnabled()) {
      return NextResponse.json({ error: 'Online payments are not available' }, { status: 400 })
    }

    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { orderId } = await request.json()
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
    }

    // Fetch order and validate ownership
    const order = await queryOne(
      'SELECT id, order_number, user_id, total_amount, payment_status FROM orders WHERE id = $1 AND user_id = $2',
      [orderId, authUser.userId]
    )

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.payment_status === 'paid') {
      return NextResponse.json({ error: 'Order is already paid' }, { status: 400 })
    }

    // Create Razorpay order
    const razorpay = getRazorpayInstance()
    const amountInPaise = Math.round(parseFloat(order.total_amount) * 100)

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: order.order_number,
      payment_capture: true,
      notes: {
        order_id: order.id,
        order_number: order.order_number,
      },
    })

    // Insert pending payment row
    await queryOne(
      `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
       VALUES ($1, 'razorpay', 'razorpay', $2, $3, 'pending', $4)
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING id`,
      [
        order.id,
        razorpayOrder.id,
        order.total_amount,
        JSON.stringify({ razorpay_order_id: razorpayOrder.id }),
      ]
    )

    return NextResponse.json({
      razorpayOrderId: razorpayOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      orderId: order.id,
    })
  } catch (error) {
    console.error('Razorpay create order error:', error)
    return NextResponse.json({ error: 'Failed to create payment order' }, { status: 500 })
  }
}
