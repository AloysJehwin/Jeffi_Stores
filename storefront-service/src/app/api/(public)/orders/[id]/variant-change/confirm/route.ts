import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { queryOne, query, resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor, isRazorpayEnabled } from '@/lib/payments/razorpay'
import { applyVariantChange } from '@/lib/orders/variant-change'
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

    // ── REFUND: apply now; an admin issues the refund from the order page ─────
    if (settlement === 'refund') {
      const applied = await applyVariantChange(vcr.id)
      if (!applied.applied)
        return NextResponse.json({ error: `Could not apply change: ${applied.reason}` }, { status: 409 })
      return NextResponse.json({ success: true, settlement: 'refund_pending' })
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
      const { instance: razorpay, creds } = await getRazorpayInstanceFor(collectTenant?.tenantId)
      const rzpOrder = await razorpay.orders.create({
        amount: diffPaise,
        currency: 'INR',
        receipt: `vcr-${vcr.id.slice(0, 30)}`,
        notes: { purpose: 'variant_change', vcrId: vcr.id, orderId, tenant_id: collectTenant?.tenantId ?? '', tenant_slug: collectTenant?.slug ?? '' },
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
        key_id: creds?.key_id,
      })
    }

    return NextResponse.json({ error: 'Unknown settlement type.' }, { status: 400 })
  } catch (err: any) {
    const message = err?.error?.description || err?.message || 'Failed to confirm variant change'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
