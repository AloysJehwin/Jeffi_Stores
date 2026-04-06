import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { sendOrderConfirmationEmail, sendNewOrderNotification, sendPaymentStatusUpdate } from '@/lib/email'
import { generateOrderInvoice } from '@/lib/invoice'

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = await request.json()

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
      return NextResponse.json({ error: 'Missing payment details' }, { status: 400 })
    }

    // Verify HMAC signature
    const body = razorpay_order_id + '|' + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(body)
      .digest('hex')

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
    }

    // Fetch order with ownership check
    const order = await queryOne(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [orderId, authUser.userId]
    )

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Idempotency: already paid
    if (order.payment_status === 'paid') {
      return NextResponse.json({
        success: true,
        order: { id: order.id, orderNumber: order.order_number, paymentStatus: 'paid' },
      })
    }

    // Update order and payment in transaction
    await withTransaction(async (client) => {
      // Update order status
      await client.query(
        `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = NOW()
         WHERE id = $1 AND payment_status != 'paid'`,
        [orderId]
      )

      // Update payment record
      const updateResult = await client.query(
        `UPDATE payments
         SET transaction_id = $1, status = 'completed',
             gateway_response = $2, updated_at = NOW()
         WHERE order_id = $3 AND payment_gateway = 'razorpay' AND status = 'pending'`,
        [
          razorpay_payment_id,
          JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature }),
          orderId,
        ]
      )

      // If no pending row was updated, insert fresh
      if (updateResult.rowCount === 0) {
        await client.query(
          `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
           VALUES ($1, 'razorpay', 'razorpay', $2, $3, 'completed', $4)
           ON CONFLICT (transaction_id) DO NOTHING`,
          [
            orderId,
            razorpay_payment_id,
            order.total_amount,
            JSON.stringify({ razorpay_order_id, razorpay_payment_id, razorpay_signature }),
          ]
        )
      }

      // Clear cart
      await client.query('DELETE FROM cart_items WHERE user_id = $1', [authUser.userId])
    })

    // Send emails asynchronously
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [authUser.userId])
    const orderItems = await queryMany(
      'SELECT * FROM order_items WHERE order_id = $1',
      [orderId]
    )

    // Generate invoice (GST only)
    let invoicePdfBuffer: Buffer | null = null
    try {
      invoicePdfBuffer = await generateOrderInvoice(orderId)
    } catch (err) {
      console.error('Failed to generate invoice:', err)
    }

    if (user) {
      const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'

      // Re-fetch order to get invoice_number
      const updatedOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [orderId])

      sendOrderConfirmationEmail(user.email, updatedOrder || order, orderItems || [], invoicePdfBuffer).catch(err =>
        console.error('Failed to send order confirmation email:', err)
      )
      sendNewOrderNotification(updatedOrder || order, orderItems || [], user).catch(err =>
        console.error('Failed to send new order notification:', err)
      )
      sendPaymentStatusUpdate(user.email, userName, order.order_number, orderId, 'paid', parseFloat(order.total_amount)).catch(err =>
        console.error('Failed to send payment status update:', err)
      )
    }

    return NextResponse.json({
      success: true,
      order: { id: order.id, orderNumber: order.order_number, paymentStatus: 'paid' },
    })
  } catch (error) {
    console.error('Payment verification error:', error)
    return NextResponse.json({ error: 'Payment verification failed' }, { status: 500 })
  }
}
