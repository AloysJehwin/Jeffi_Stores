import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { sendOrderStatusUpdate } from '@/lib/email'
import { cancelDelhiveryShipment } from '@/lib/delhivery'
import { restoreOrderStock } from '@/lib/order-stock'
import { logActivity } from '@/lib/activity'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = id
    const body = await request.json()
    const { action, note } = body

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be "approve" or "reject".' }, { status: 400 })
    }

    if (action === 'reject' && (!note || !note.trim())) {
      return NextResponse.json({ error: 'A reason is required when rejecting a cancellation.' }, { status: 400 })
    }

    const order = await queryOne(
      `
      SELECT o.id, o.order_number, o.status, o.payment_status, o.total_amount,
        o.customer_name, o.customer_email, o.user_id, o.awb_number,
        json_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `,
      [orderId]
    )

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.status !== 'cancel_requested') {
      return NextResponse.json(
        { error: `Order is not pending cancellation — current status is "${order.status}"` },
        { status: 400 }
      )
    }

    let newStatus: string

    if (action === 'approve') {
      // Approving a cancellation ONLY cancels the order (+ restores stock +
      // cancels any shipment). It deliberately does NOT touch money — the refund
      // is a separate, explicit step ("Initiate Refund") that refunds ALL
      // payments (the initial charge plus any top-ups) via /api/orders/[id]/refund.
      // We therefore leave payment_status = 'paid' so the "Refund Pending" card
      // surfaces and the admin can trigger the full refund deliberately.

      // Stock is only deducted when an admin moves the order to 'processing'.
      // A confirmed (paid) order cancelled before reaching processing has no stock
      // impact. Detect an actual sale rather than inferring from payment/status.
      const saleRecord = await queryOne(
        `SELECT id FROM inventory_transactions WHERE reference_id = $1 AND transaction_type = 'sale' LIMIT 1`,
        [orderId]
      )
      const wasStockDeducted = !!saleRecord

      await query(`UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [orderId])

      // Restore inventory via the shared helper: resets serials to in_stock,
      // reverses product_batches quantity_remaining, and syncs shelf_stock — the
      // full counterpart of deductOrderStock. Idempotent (guards on an existing
      // 'return' ledger row), and a no-op when stock was never deducted.
      if (wasStockDeducted) {
        await restoreOrderStock(orderId)
      }

      newStatus = 'cancelled'

      if (order.awb_number) {
        await cancelDelhiveryShipment(order.awb_number).catch(() => {})
      }
    } else {
      await query(
        `UPDATE orders SET status = 'cancel_rejected', cancellation_note = $2, updated_at = NOW() WHERE id = $1`,
        [orderId, note.trim()]
      )
      newStatus = 'cancel_rejected'
    }

    const user = order.users
    const userEmail = user?.email || order.customer_email
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : order.customer_name

    if (userEmail && userName) {
      sendOrderStatusUpdate(
        userEmail,
        userName,
        order.order_number,
        orderId,
        newStatus,
        'cancel_requested',
        null,
        newStatus === 'cancel_rejected' ? note.trim() : undefined
      ).catch(() => {})
    }

    if (order.user_id) {
      logActivity({
        userId: order.user_id,
        actorId: admin.adminId,
        kind: 'order_status',
        referenceId: orderId,
        referenceType: 'orders',
        summary:
          newStatus === 'cancelled'
            ? `Cancellation approved for #${order.order_number}`
            : `Cancellation rejected for #${order.order_number}: ${note.trim()}`,
        metadata: { order_status: newStatus, action, note: note?.trim() || null },
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, newStatus })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to process cancellation review' }, { status: 500 })
  }
}
