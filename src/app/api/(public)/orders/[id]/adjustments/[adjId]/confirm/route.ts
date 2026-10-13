import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { queryOne, query, resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor, isRazorpayEnabled } from '@/lib/payments/razorpay'
import { applyAdjustment } from '@/lib/orders/adjustments'
import { refundAcrossPayments } from '@/lib/payments/refund'

export const dynamic = 'force-dynamic'

// POST — the customer accepts the proposed changes.
//   refund      → refund the difference across the order's payments (tenant's keys), then apply
//   collect     → open a Razorpay order on the tenant's keys; applied by verify/webhook once paid
//   cod_adjust / none → apply now
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; adjId: string }> }) {
  const { id: orderId, adjId } = await params
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const adj = await queryOne<any>(
      `SELECT a.*, o.order_number, o.user_id, o.status AS order_status, o.awb_number, o.original_order_id
         FROM order_adjustments a JOIN orders o ON o.id = a.order_id
        WHERE a.id = $1 AND a.order_id = $2`,
      [adjId, orderId]
    )
    if (!adj) return NextResponse.json({ error: 'Change request not found.' }, { status: 404 })
    if (adj.user_id && adj.user_id !== user.userId) return NextResponse.json({ error: 'This order does not belong to you.' }, { status: 403 })
    if (adj.status !== 'pending_customer' && adj.status !== 'awaiting_payment')
      return NextResponse.json({ error: 'This change is no longer open.' }, { status: 409 })
    if (adj.order_status !== 'confirmed' || adj.awb_number)
      return NextResponse.json({ error: 'This order can no longer be changed (it has moved to fulfilment).' }, { status: 400 })

    const amount = Math.abs(Number(adj.net_diff))
    const tenant = await resolveRequestTenant()

    if (adj.settlement_type === 'refund') {
      if (!(await isRazorpayEnabled())) return NextResponse.json({ error: 'Payment gateway not configured.' }, { status: 400 })
      // Claim first so a double click can't refund twice.
      const claimed = await queryOne(
        `UPDATE order_adjustments SET status = 'awaiting_payment', updated_at = NOW() WHERE id = $1 AND status = 'pending_customer' RETURNING id`,
        [adjId]
      )
      if (!claimed) return NextResponse.json({ error: 'This change is already being processed.' }, { status: 409 })
      try {
        const { refunds } = await refundAcrossPayments({
          orderId: adj.original_order_id || orderId,
          amount,
          orderRef: adj.order_number,
          purpose: 'order_adjustment',
          tenantId: tenant?.tenantId,
        })
        await query(`UPDATE order_adjustments SET refunds = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(refunds), adjId])
      } catch (e: any) {
        const done = e?.refunds ?? []
        await query(`UPDATE order_adjustments SET status = $1, refunds = $2::jsonb, updated_at = NOW() WHERE id = $3`, [
          done.length ? 'awaiting_payment' : 'pending_customer', JSON.stringify(done), adjId,
        ])
        console.error(`[order-adjustment] refund failed adj=${adjId}`, e)
        return NextResponse.json({ error: e?.error?.description || e?.message || 'Refund failed — please contact support.' }, { status: 502 })
      }
      const r = await applyAdjustment(adjId)
      if (!r.applied && r.reason !== 'already_applied') return NextResponse.json({ error: `Refunded, but the change could not be applied: ${r.reason}. Contact support.` }, { status: 409 })
      return NextResponse.json({ success: true, settlement: 'refund' })
    }

    if (adj.settlement_type === 'collect') {
      if (!(await isRazorpayEnabled())) return NextResponse.json({ error: 'Payment gateway not configured.' }, { status: 400 })
      const { instance, creds } = await getRazorpayInstanceFor(tenant?.tenantId)
      let rzpOrderId = adj.razorpay_order_id as string | null
      if (!rzpOrderId) {
        const o = await instance.orders.create({
          amount: Math.round(amount * 100),
          currency: 'INR',
          receipt: `adj-${String(adjId).slice(0, 30)}`,
          notes: { purpose: 'order_adjustment', adjustmentId: adjId, orderId, tenant_id: tenant?.tenantId ?? '', tenant_slug: tenant?.slug ?? '' },
        })
        rzpOrderId = o.id
        await query(`UPDATE order_adjustments SET status = 'awaiting_payment', razorpay_order_id = $1, updated_at = NOW() WHERE id = $2`, [rzpOrderId, adjId])
      }
      return NextResponse.json({ success: true, settlement: 'collect', razorpayOrderId: rzpOrderId, amount: Math.round(amount * 100), currency: 'INR', key_id: creds.key_id })
    }

    const r = await applyAdjustment(adjId)
    if (!r.applied && r.reason !== 'already_applied') return NextResponse.json({ error: `Could not apply the change: ${r.reason}` }, { status: 409 })
    return NextResponse.json({ success: true, settlement: adj.settlement_type })
  } catch (err: any) {
    return NextResponse.json({ error: err?.error?.description || err?.message || 'Failed to confirm the change' }, { status: 500 })
  }
}
