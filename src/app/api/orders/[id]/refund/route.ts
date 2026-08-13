import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany, query } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { getRazorpayInstance, isRazorpayEnabled } from '@/lib/razorpay'
import { sendPaymentStatusUpdate } from '@/lib/email'
import { logActivity } from '@/lib/activity'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = id

    const order = await queryOne(`
      SELECT o.id, o.order_number, o.status, o.payment_status, o.total_amount,
        o.customer_name, o.customer_email, o.user_id, o.original_order_id,
        json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `, [orderId])

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.status !== 'cancelled' && order.status !== 'returned') {
      return NextResponse.json({ error: 'Refund can only be initiated for cancelled or returned orders.' }, { status: 400 })
    }

    if (order.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Order has not been paid or has already been refunded.' }, { status: 400 })
    }

    if (!(await isRazorpayEnabled())) {
      return NextResponse.json({ error: 'Payment gateway is not configured.' }, { status: 400 })
    }

    const paymentOrderId = order.original_order_id || orderId

    // Refund EVERY completed Razorpay payment on the order — the initial charge
    // AND any later top-ups (e.g. a variant-change collection). A single LIMIT 1
    // refund would leave top-ups un-refunded.
    const paymentRecords = await queryMany<any>(
      `SELECT id, transaction_id, amount, gateway_response FROM payments
       WHERE order_id = $1 AND payment_gateway = 'razorpay' AND status = 'completed'`,
      [paymentOrderId]
    )

    const refundable = (paymentRecords || []).filter((p: any) => p.transaction_id)
    if (refundable.length === 0) {
      return NextResponse.json({ error: 'No Razorpay payment record found for this order.' }, { status: 400 })
    }

    const razorpay = getRazorpayInstance()
    const refundIds: string[] = []
    let totalRefunded = 0
    for (const paymentRecord of refundable) {
      const amountInPaise = Math.round(parseFloat(paymentRecord.amount) * 100)
      const refund = await razorpay.payments.refund(paymentRecord.transaction_id, { amount: amountInPaise })
      refundIds.push(refund.id)
      totalRefunded += Number(paymentRecord.amount)

      const existingResponse = typeof paymentRecord.gateway_response === 'string'
        ? JSON.parse(paymentRecord.gateway_response)
        : (paymentRecord.gateway_response || {})

      await query(
        `UPDATE payments SET status = 'refunded', gateway_response = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ ...existingResponse, refund }), paymentRecord.id]
      )
    }

    await query(
      `UPDATE orders SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
      [orderId]
    )

    const user = order.users
    const userEmail = user?.email || order.customer_email
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : order.customer_name

    if (userEmail && userName) {
      sendPaymentStatusUpdate(
        userEmail, userName, order.order_number, orderId,
        'refunded', parseFloat(order.total_amount)
      ).catch(() => {})
    }

    if (order.user_id) {
      logActivity({
        userId: order.user_id,
        actorId: admin.adminId,
        kind: 'payment_status',
        referenceId: orderId,
        referenceType: 'orders',
        summary: `Refund issued for #${order.order_number} (₹${totalRefunded.toFixed(0)}${refundIds.length > 1 ? `, ${refundIds.length} payments` : ''})`,
        metadata: { payment_status: 'refunded', amount: totalRefunded, refundIds },
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, refundIds, totalRefunded })
  } catch (err: any) {
    const message = err?.error?.description || err?.message || 'Failed to initiate refund'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
