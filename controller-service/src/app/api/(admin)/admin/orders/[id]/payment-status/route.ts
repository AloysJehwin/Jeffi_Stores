import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { PAYMENT_STATUSES, manualPaymentStatusError, orderLockedError } from '@/lib/orders/status-flow'

export const dynamic = 'force-dynamic'

const ALLOWED = [...PAYMENT_STATUSES, 'partial']

// Hand-set payment status (receivables "mark paid", the admin agent). Same rules as the order
// status endpoint: the normal moves only, never a bare "refunded" (that is the refund flow's job),
// and anything else needs an administrator / super admin override with a reason.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const payment_status = typeof body?.payment_status === 'string' ? body.payment_status : ''
    const override = body?.override === true
    const reason = typeof body?.override_reason === 'string' ? body.override_reason.trim() : ''
    const paymentMode = typeof body?.payment_mode === 'string' ? body.payment_mode.trim().slice(0, 50) : ''
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : ''

    if (!ALLOWED.includes(payment_status)) {
      return NextResponse.json({ error: 'Invalid payment_status' }, { status: 400 })
    }
    if (override) {
      if (!isPlatformOwner(admin.role)) {
        return NextResponse.json({ error: 'Only a super admin can override the payment status' }, { status: 403 })
      }
      if (reason.length < 10 || reason.length > 500) {
        return NextResponse.json(
          { error: 'override_reason is required when overriding (10-500 characters)' },
          { status: 400 }
        )
      }
    }

    const order = await queryOne<{ id: string; order_number: string; status: string; payment_status: string }>(
      'SELECT id, order_number, status, payment_status FROM orders WHERE id = $1',
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    // Cancelled and returned orders settle money through refunds; a rejected cancel/return still owes payment.
    const ruleError =
      (override || !['cancelled', 'returned'].includes(order.status) ? null : orderLockedError(order.status)) ||
      manualPaymentStatusError(order.payment_status, payment_status, override, ALLOWED)
    if (ruleError) return NextResponse.json({ error: ruleError }, { status: 400 })
    if (order.payment_status === payment_status) return NextResponse.json({ success: true, payment_status })

    await query('UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2', [payment_status, id])

    await logAdminAudit({
      adminId: admin.adminId,
      action: 'update',
      entityType: 'order',
      entityId: id,
      summary: `Payment status${override ? ' override' : ''} on ${order.order_number}: ${order.payment_status} → ${payment_status}`,
      diff: { payment_status: { from: order.payment_status, to: payment_status } },
      metadata: {
        ...(override ? { override: true, reason, role: admin.role } : {}),
        ...(paymentMode ? { payment_mode: paymentMode } : {}),
        ...(note ? { note } : {}),
      },
      request,
    }).catch(() => {})

    return NextResponse.json({ success: true, payment_status })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
