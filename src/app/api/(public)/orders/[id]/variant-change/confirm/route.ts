import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { queryOne, query, resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor, isRazorpayEnabled } from '@/lib/payments/razorpay'
import { applyVariantChange } from '@/lib/orders/variant-change'
import { reverseTransfersForRefund, recordRefundSettlement } from '@/lib/payments/razorpay-route'
import { controlPlanePool } from '@/lib/tenant-registry'
import { logActivity } from '@/lib/shared/activity'

export const dynamic = 'force-dynamic'

// POST /api/orders/[id]/variant-change/confirm — customer accepts the proposed swap.
// - refund     → partial Razorpay refund of the difference, then apply the swap.
// - cod_adjust → apply the swap; new total is payable on delivery.
// - none       → apply the swap (no money movement).
// - collect    → create a Razorpay order for the extra; return it so the client
//                opens Checkout; the swap applies later via the verify hook.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orderId } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const vcr = await queryOne<any>(
      `SELECT vcr.*, o.order_number, o.user_id, o.status AS order_status, o.awb_number, o.payment_status,
              o.original_order_id
       FROM variant_change_requests vcr
       JOIN orders o ON o.id = vcr.order_id
       WHERE vcr.order_id = $1 AND vcr.status = 'pending_customer'
       ORDER BY vcr.created_at DESC LIMIT 1`,
      [orderId]
    )
    if (!vcr) return NextResponse.json({ error: 'No pending variant change request for this order.' }, { status: 404 })
    if (vcr.user_id && vcr.user_id !== authUser.userId) {
      return NextResponse.json({ error: 'This order does not belong to you.' }, { status: 403 })
    }
    if (vcr.order_status !== 'confirmed' || vcr.awb_number) {
      return NextResponse.json(
        { error: 'This order can no longer be changed (it has moved to fulfilment).' },
        { status: 400 }
      )
    }

    const priceDiff = Number(vcr.price_diff)
    const settlement = vcr.settlement_type as 'refund' | 'collect' | 'cod_adjust' | 'none'

    // ── REFUND: partial Razorpay refund of the difference, then apply ──────────
    if (settlement === 'refund') {
      if (!(await isRazorpayEnabled()))
        return NextResponse.json({ error: 'Payment gateway not configured.' }, { status: 400 })
      const paymentOrderId = vcr.original_order_id || orderId
      const payment = await queryOne<any>(
        `SELECT id, transaction_id, gateway_response FROM payments
         WHERE order_id = $1 AND payment_gateway = 'razorpay' AND status = 'completed' LIMIT 1`,
        [paymentOrderId]
      )
      if (!payment?.transaction_id)
        return NextResponse.json({ error: 'No Razorpay payment found to refund against.' }, { status: 400 })

      const diffPaise = Math.round(Math.abs(priceDiff) * 100)
      // Tenant-aware: an own_razorpay tenant collected on THEIR keys, so refunding from platform
      // keys fails outright.
      const tenant = await resolveRequestTenant()
      const ownRazorpay = tenant?.tenantId
        ? await controlPlanePool()
            .query(`SELECT own_razorpay FROM tenants WHERE id=$1`, [tenant.tenantId])
            .then(r => r.rows[0]?.own_razorpay === true)
            .catch(() => false)
        : false
      const { instance: razorpay } = await getRazorpayInstanceFor(tenant?.tenantId)
      const refund = await razorpay.payments.refund(payment.transaction_id, { amount: diffPaise })

      // Claw back the tenant's share of the diff. This usually runs BEFORE dispatch, so the
      // transfer is still on_hold and the reversal is the cleanest of the three refund paths.
      if (!ownRazorpay) {
        const outcome = await reverseTransfersForRefund(payment.transaction_id, diffPaise)
        if (outcome.unrecoveredPaise > 0) {
          console.error(
            `[variant-change] transfer reversal INCOMPLETE order=${orderId} payment=${payment.transaction_id} ` +
              `unrecoveredPaise=${outcome.unrecoveredPaise}${outcome.lookupError ? ` lookupError=${outcome.lookupError}` : ''}`
          )
        }
        if (tenant?.tenantId && (outcome.reversedPaise > 0 || outcome.unrecoveredPaise > 0)) {
          await recordRefundSettlement({
            tenantId: tenant.tenantId,
            orderRef: vcr.order_number,
            refundedInr: Math.abs(priceDiff),
            reversedInr: outcome.reversedPaise / 100,
            unrecoveredInr: outcome.unrecoveredPaise / 100,
            note: 'variant change',
          })
        }
      }

      const existing =
        typeof payment.gateway_response === 'string'
          ? JSON.parse(payment.gateway_response)
          : payment.gateway_response || {}
      // Keep payment_status = 'paid' (this is a partial diff refund, not a full refund).
      await query(`UPDATE payments SET gateway_response = $1, updated_at = NOW() WHERE id = $2`, [
        JSON.stringify({ ...existing, variantChangeRefund: refund }),
        payment.id,
      ])
      await query(`UPDATE variant_change_requests SET refund_id = $1, updated_at = NOW() WHERE id = $2`, [
        refund.id,
        vcr.id,
      ])

      const applied = await applyVariantChange(vcr.id)
      if (!applied.applied)
        return NextResponse.json({ error: `Could not apply change: ${applied.reason}` }, { status: 409 })
      return NextResponse.json({ success: true, settlement: 'refund', refundId: refund.id })
    }

    // ── COD adjust / no-diff: just apply ───────────────────────────────────────
    if (settlement === 'cod_adjust' || settlement === 'none') {
      const applied = await applyVariantChange(vcr.id)
      if (!applied.applied)
        return NextResponse.json({ error: `Could not apply change: ${applied.reason}` }, { status: 409 })
      return NextResponse.json({ success: true, settlement })
    }

    // ── COLLECT: create a Razorpay order for the extra; apply on verify ────────
    if (settlement === 'collect') {
      if (!(await isRazorpayEnabled()))
        return NextResponse.json({ error: 'Payment gateway not configured.' }, { status: 400 })
      const diffPaise = Math.round(Math.abs(priceDiff) * 100)
      if (diffPaise <= 0) return NextResponse.json({ error: 'Nothing to collect.' }, { status: 400 })
      // Collect the extra on the tenant's own account (own_razorpay) or the platform account
      // that carries their Route linked account — never a bare platform instance, which would
      // take an own-account tenant's buyer payment into Jeffi's account.
      const collectTenant = await resolveRequestTenant()
      const { instance: razorpay } = await getRazorpayInstanceFor(collectTenant?.tenantId)
      const rzpOrder = await razorpay.orders.create({
        amount: diffPaise,
        currency: 'INR',
        receipt: `vcr-${vcr.id.slice(0, 30)}`,
        notes: { purpose: 'variant_change', vcrId: vcr.id, orderId },
      })
      await query(
        `UPDATE variant_change_requests SET status = 'awaiting_payment', razorpay_order_id = $1, updated_at = NOW() WHERE id = $2`,
        [rzpOrder.id, vcr.id]
      )
      if (vcr.user_id) {
        logActivity({
          userId: vcr.user_id,
          kind: 'variant_change',
          referenceId: orderId,
          referenceType: 'orders',
          summary: `Customer accepted variant change on #${vcr.order_number}; collecting ₹${Math.abs(priceDiff).toFixed(2)}`,
          metadata: { vcrId: vcr.id, razorpayOrderId: rzpOrder.id },
        }).catch(() => {})
      }
      return NextResponse.json({
        success: true,
        settlement: 'collect',
        razorpayOrderId: rzpOrder.id,
        amount: diffPaise,
        currency: 'INR',
      })
    }

    return NextResponse.json({ error: 'Unknown settlement type.' }, { status: 400 })
  } catch (err: any) {
    const message = err?.error?.description || err?.message || 'Failed to confirm variant change'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
