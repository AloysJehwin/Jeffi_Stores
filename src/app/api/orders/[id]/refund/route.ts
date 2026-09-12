import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany, query, resolveRequestTenant } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { getRazorpayInstanceFor, isRazorpayEnabled } from '@/lib/razorpay'
import { fetchTransferIdForPayment, reverseTransfer } from '@/lib/razorpay-route'
import { controlPlanePool } from '@/lib/tenant-registry'
import { sendPaymentStatusUpdate } from '@/lib/email'
import { logActivity } from '@/lib/activity'
import { getReturnRequest } from '@/lib/queries'
import { computeRefundableAmount } from '@/lib/refund'

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

    const returnRequest = order.status === 'returned' ? await getReturnRequest(orderId).catch(() => null) : null
    const capturedTotal = refundable.reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0)
    const targetRefund = Math.min(capturedTotal, await computeRefundableAmount(order, returnRequest))

    if (!(targetRefund > 0)) {
      return NextResponse.json({ error: 'Nothing to refund after the return standard charge.' }, { status: 400 })
    }

    // Refund from the SAME account that collected: the tenant's own keys when they use their own
    // Razorpay, else the platform account. A platform refund of an own-account payment would fail.
    const tenant = await resolveRequestTenant()
    const ownRazorpay = tenant?.tenantId
      ? await controlPlanePool()
          .query(`SELECT own_razorpay FROM tenants WHERE id=$1`, [tenant.tenantId])
          .then(r => r.rows[0]?.own_razorpay === true)
          .catch(() => false)
      : false

    const { instance: razorpay } = await getRazorpayInstanceFor(tenant?.tenantId)
    const refundIds: string[] = []
    let totalRefunded = 0
    let remaining = targetRefund
    for (const paymentRecord of refundable) {
      if (remaining <= 0) break
      const captured = parseFloat(paymentRecord.amount) || 0
      const thisRefund = Math.min(captured, remaining)
      if (!(thisRefund > 0)) continue
      const amountInPaise = Math.round(thisRefund * 100)
      const refund = await razorpay.payments.refund(paymentRecord.transaction_id, { amount: amountInPaise })
      refundIds.push(refund.id)
      totalRefunded += thisRefund
      remaining = Math.round((remaining - thisRefund) * 100) / 100

      // For platform-keys tenants the buyer money was Route-transferred to the linked account, so
      // reverse the tenant's share proportional to this refund. Own-account tenants were never
      // transferred (platform never held the money), so there is nothing to reverse.
      let transferReversal: unknown = null
      if (!ownRazorpay) {
        const transferId = await fetchTransferIdForPayment(paymentRecord.transaction_id)
        if (transferId) {
          transferReversal = await reverseTransfer(transferId, amountInPaise)
            .then(() => ({ transferId, amountPaise: amountInPaise }))
            .catch((e: any) => ({ transferId, amountPaise: amountInPaise, error: e?.message || 'reverse failed' }))
        }
      }

      const existingResponse = typeof paymentRecord.gateway_response === 'string'
        ? JSON.parse(paymentRecord.gateway_response)
        : (paymentRecord.gateway_response || {})

      await query(
        `UPDATE payments SET status = 'refunded', gateway_response = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ ...existingResponse, refund, ...(transferReversal ? { transferReversal } : {}) }), paymentRecord.id]
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
        'refunded', totalRefunded
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
