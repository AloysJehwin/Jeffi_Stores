import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query, resolveRequestTenant } from '@/lib/shared/db'
import { restoreOrderStock } from '@/lib/orders/order-stock'
import { cancelInvoicePaymentArtifacts } from '@/lib/payments/razorpay'
import { logAdminAudit } from '@/lib/shared/admin-audit'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(
      `SELECT id, order_number, status, payment_status, source,
              payment_link_id, payment_link_status, razorpay_qr_id
       FROM orders WHERE id = $1`,
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.source !== 'offline') {
      return NextResponse.json({ error: 'Only offline invoices can be cancelled from here' }, { status: 400 })
    }
    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'Invoice is already cancelled' }, { status: 400 })
    }

    await restoreOrderStock(id)

    // Money already collected or refunded keeps its status, so a paid invoice shows "Refund pending"
    // and can go through the refund flow; an unpaid one is voided.
    await query(
      `UPDATE orders SET status = 'cancelled',
              payment_status = CASE WHEN payment_status IN ('paid', 'cod_collected', 'refunded') THEN payment_status ELSE 'cancelled' END,
              updated_at = NOW()
        WHERE id = $1`,
      [id]
    )
    await logAdminAudit({
      adminId: admin.adminId,
      action: 'update',
      entityType: 'order',
      entityId: id,
      summary: `Invoice ${order.order_number} cancelled`,
      diff: { status: { from: order.status, to: 'cancelled' } },
      metadata: { source: 'offline', payment_status: order.payment_status },
      request,
    }).catch(() => {})

    // Void the open payment artifacts so a buyer can no longer pay a cancelled invoice. Best-effort:
    // never fails the cancel, and marks the payment link cancelled locally when the gateway confirms.
    let paymentArtifacts: unknown = null
    if (order.payment_link_id || order.razorpay_qr_id) {
      const tenant = await resolveRequestTenant().catch(() => null)
      const res = await cancelInvoicePaymentArtifacts({
        tenantId: tenant?.tenantId,
        paymentLinkId: order.payment_link_id,
        paymentLinkStatus: order.payment_link_status,
        qrId: order.razorpay_qr_id,
      })
      paymentArtifacts = res
      if (res.paymentLink === 'cancelled') {
        await query(`UPDATE orders SET payment_link_status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]).catch(
          () => {}
        )
      }
    }

    return NextResponse.json({ success: true, paymentArtifacts })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to cancel invoice' }, { status: 500 })
  }
}
