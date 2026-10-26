import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query, resolveRequestTenant } from '@/lib/shared/db'
import { isRazorpayEnabled } from '@/lib/payments/razorpay'
import { externalRefundCeiling, recordExternalRefund, refundAcrossPayments } from '@/lib/payments/refund'
import { RAZORPAY_ONLY_METHODS, externalRefundLabel, parseExternalRefund } from '@/lib/payments/external-refund'
import { logActivity } from '@/lib/shared/activity'

export const dynamic = 'force-dynamic'

// POST — issue the refund owed by an approved product adjustment (?legacy=1: an old variant change).
// Body { external } records a refund made another way (bank transfer, dispute…) instead of calling Razorpay.
// The row is claimed first so a double click can't refund twice; a failed refund releases the claim.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; adjId: string }> }) {
  const { id: orderId, adjId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const external = body?.external ? parseExternalRefund(body.external) : null
  if (typeof external === 'string') return NextResponse.json({ error: external }, { status: 400 })
  if (!external && !(await isRazorpayEnabled())) return NextResponse.json({ error: 'Payment gateway is not configured.' }, { status: 400 })
  const legacy = request.nextUrl.searchParams.get('legacy') === '1'

  const claimed = legacy
    ? await queryOne<{ amount: string }>(
        `UPDATE variant_change_requests SET refund_id = 'processing', updated_at = NOW()
          WHERE id = $1 AND order_id = $2 AND settlement_type = 'refund' AND status = 'applied' AND refund_id IS NULL
          RETURNING abs(price_diff) AS amount`,
        [adjId, orderId]
      )
    : await queryOne<{ amount: string }>(
        `UPDATE order_adjustments SET refund_status = 'refunded', updated_at = NOW()
          WHERE id = $1 AND order_id = $2 AND refund_status = 'pending'
          RETURNING abs(net_diff) AS amount`,
        [adjId, orderId]
      )
  if (!claimed) return NextResponse.json({ error: 'This refund was already issued or is not due.' }, { status: 409 })

  const order = await queryOne<{ order_number: string; user_id: string | null; original_order_id: string | null }>(
    `SELECT order_number, user_id, original_order_id FROM orders WHERE id = $1`,
    [orderId]
  )
  const amount = Number(claimed.amount)
  const tenant = await resolveRequestTenant()
  if (external) {
    const paymentOrderId = order?.original_order_id || orderId
    const ceiling = await externalRefundCeiling(paymentOrderId)
    try {
      if (ceiling === null && RAZORPAY_ONLY_METHODS.includes(external.method)) throw new Error('This order has no Razorpay payment to refund.')
      if (ceiling !== null && amount > ceiling + 0.01) throw new Error(`Only ₹${ceiling.toFixed(2)} is left to refund on this order's payments.`)
      await recordExternalRefund({
        orderId: paymentOrderId,
        amount,
        full: false,
        refund: external,
        purpose: legacy ? 'variant_change' : 'order_adjustment',
        orderRef: order?.order_number ?? orderId,
        actorId: admin.adminId,
        tenantId: tenant?.tenantId,
      })
    } catch (e: any) {
      if (legacy) await query(`UPDATE variant_change_requests SET refund_id = NULL WHERE id = $1`, [adjId])
      else await query(`UPDATE order_adjustments SET refund_status = 'pending' WHERE id = $1`, [adjId])
      return NextResponse.json({ error: e?.message || 'Could not record the refund' }, { status: 400 })
    }
    const refunds = [{ id: external.reference ?? 'external', amount, method: external.method }]
    if (legacy) await query(`UPDATE variant_change_requests SET refund_id = $1, updated_at = NOW() WHERE id = $2`, [`external:${external.method}`, adjId])
    else await query(`UPDATE order_adjustments SET refunds = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(refunds), adjId])
    if (order?.user_id) {
      logActivity({
        userId: order.user_id,
        actorId: admin.adminId,
        kind: 'order_adjustment',
        referenceId: orderId,
        referenceType: 'orders',
        summary: `Refund of ₹${amount.toFixed(2)} for the changes on #${order.order_number} recorded (${externalRefundLabel(external.method)})`,
        metadata: { adjustmentId: adjId, legacy, external },
      }).catch(() => {})
    }
    return NextResponse.json({ success: true, refunded: amount, external })
  }
  try {
    const { refunds } = await refundAcrossPayments({
      orderId: order?.original_order_id || orderId,
      amount,
      orderRef: order?.order_number ?? orderId,
      purpose: legacy ? 'variant_change' : 'order_adjustment',
      tenantId: tenant?.tenantId,
    })
    if (legacy) await query(`UPDATE variant_change_requests SET refund_id = $1, updated_at = NOW() WHERE id = $2`, [refunds[0]?.id ?? null, adjId])
    else await query(`UPDATE order_adjustments SET refunds = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(refunds), adjId])
    if (order?.user_id) {
      logActivity({
        userId: order.user_id,
        actorId: admin.adminId,
        kind: 'order_adjustment',
        referenceId: orderId,
        referenceType: 'orders',
        summary: `Refunded ₹${amount.toFixed(2)} for the changes on #${order.order_number}`,
        metadata: { adjustmentId: adjId, legacy, refunds },
      }).catch(() => {})
    }
    return NextResponse.json({ success: true, refunded: amount, refunds })
  } catch (e: any) {
    const done = e?.refunds ?? []
    if (!done.length) {
      // Nothing went out: release the claim so it can be retried.
      if (legacy) await query(`UPDATE variant_change_requests SET refund_id = NULL WHERE id = $1`, [adjId])
      else await query(`UPDATE order_adjustments SET refund_status = 'pending' WHERE id = $1`, [adjId])
    } else if (!legacy) {
      await query(`UPDATE order_adjustments SET refunds = $1::jsonb WHERE id = $2`, [JSON.stringify(done), adjId])
    }
    console.error(`[adjustment-refund] order=${orderId} adj=${adjId}`, e)
    return NextResponse.json({ error: e?.error?.description || e?.message || 'Refund failed' }, { status: 502 })
  }
}
