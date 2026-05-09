import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { sendOrderConfirmationEmail, sendNewOrderNotification, sendPaymentStatusUpdate } from '@/lib/email'

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const webhookSignature = request.headers.get('x-razorpay-signature')

    if (!webhookSignature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
    if (webhookSecret) {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex')

      if (expectedSignature !== webhookSignature) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
      }
    }

    const event = JSON.parse(rawBody)
    const eventType = event.event

    if (eventType === 'payment.captured') {
      await handlePaymentCaptured(event.payload.payment.entity)
    } else if (eventType === 'payment.failed') {
      await handlePaymentFailed(event.payload.payment.entity)
    } else if (eventType === 'payment_link.paid') {
      await handlePaymentLinkPaid(event.payload.payment_link.entity)
    } else if (eventType === 'payment_link.expired') {
      await handlePaymentLinkExpired(event.payload.payment_link.entity)
    }

    return NextResponse.json({ status: 'ok' })
  } catch {
    return NextResponse.json({ status: 'ok' })
  }
}

async function handlePaymentCaptured(payment: any) {
  const razorpayOrderId = payment.order_id
  const razorpayPaymentId = payment.id

  const paymentRecord = await queryOne(
    `SELECT p.id as payment_id, p.order_id, p.status as payment_record_status,
            o.id as db_order_id, o.payment_status, o.order_number, o.total_amount,
            o.customer_email, o.customer_name, o.user_id
     FROM payments p
     JOIN orders o ON p.order_id = o.id
     WHERE p.gateway_response->>'razorpay_order_id' = $1
     LIMIT 1`,
    [razorpayOrderId]
  )

  if (!paymentRecord) return
  if (paymentRecord.payment_status === 'paid') return

  const orderId = paymentRecord.order_id

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [orderId]
    )

    await client.query(
      `UPDATE payments
       SET transaction_id = $1, status = 'completed',
           gateway_response = $2, updated_at = NOW()
       WHERE order_id = $3 AND payment_gateway = 'razorpay' AND status = 'pending'`,
      [
        razorpayPaymentId,
        JSON.stringify({ razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, ...payment }),
        orderId,
      ]
    )

    if (paymentRecord.user_id) {
      await client.query('DELETE FROM cart_items WHERE user_id = $1', [paymentRecord.user_id])
    }
  })

  if (paymentRecord.user_id) {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [paymentRecord.user_id])
    const order = await queryOne('SELECT * FROM orders WHERE id = $1', [orderId])
    const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [orderId])

    if (user && order) {
      const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
      sendOrderConfirmationEmail(user.email, order, orderItems || []).catch(() => {})
      sendNewOrderNotification(order, orderItems || [], user).catch(() => {})
      sendPaymentStatusUpdate(user.email, userName, order.order_number, orderId, 'paid', parseFloat(order.total_amount)).catch(() => {})
    }
  }
}

async function handlePaymentFailed(payment: any) {
  const razorpayOrderId = payment.order_id

  const paymentRecord = await queryOne(
    `SELECT p.order_id FROM payments p
     WHERE p.gateway_response->>'razorpay_order_id' = $1
     LIMIT 1`,
    [razorpayOrderId]
  )

  if (!paymentRecord) return

  await queryOne(
    `UPDATE payments SET status = 'failed', gateway_response = $1, updated_at = NOW()
     WHERE order_id = $2 AND payment_gateway = 'razorpay' AND status = 'pending'`,
    [JSON.stringify(payment), paymentRecord.order_id]
  )

  await queryOne(
    `UPDATE orders SET payment_status = 'failed', updated_at = NOW()
     WHERE id = $1 AND payment_status = 'unpaid'`,
    [paymentRecord.order_id]
  )
}

async function handlePaymentLinkPaid(paymentLink: any) {
  const linkId = paymentLink.id

  const order = await queryOne(
    `SELECT id, payment_status, user_id, order_number, total_amount, customer_email, customer_name
     FROM orders WHERE payment_link_id = $1`,
    [linkId]
  )

  if (!order || order.payment_status === 'paid') return

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE orders SET
        payment_status = 'paid',
        status = 'confirmed',
        payment_link_status = 'paid',
        updated_at = NOW()
       WHERE id = $1 AND payment_status != 'paid'`,
      [order.id]
    )

    await client.query(
      `INSERT INTO payments (order_id, payment_gateway, transaction_id, amount, status, gateway_response)
       VALUES ($1, 'razorpay_link', $2, $3, 'completed', $4)
       ON CONFLICT DO NOTHING`,
      [order.id, paymentLink.payments?.[0]?.payment_id || linkId, parseFloat(order.total_amount), JSON.stringify(paymentLink)]
    )

    if (order.user_id) {
      await client.query('DELETE FROM cart_items WHERE user_id = $1', [order.user_id])
    }
  })

  if (order.user_id) {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [order.user_id])
    const fullOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [order.id])
    const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1', [order.id])
    if (user && fullOrder) {
      const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
      sendOrderConfirmationEmail(user.email, fullOrder, orderItems || []).catch(() => {})
      sendNewOrderNotification(fullOrder, orderItems || [], user).catch(() => {})
      sendPaymentStatusUpdate(user.email, userName, order.order_number, order.id, 'paid', parseFloat(order.total_amount)).catch(() => {})
    }
  }
}

async function handlePaymentLinkExpired(paymentLink: any) {
  await queryOne(
    `UPDATE orders SET payment_link_status = 'expired', updated_at = NOW()
     WHERE payment_link_id = $1 AND payment_link_status = 'created'`,
    [paymentLink.id]
  )
}
