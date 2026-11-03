import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveRequestTenant, withTransaction } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { applyRouteRefund } from '@/lib/payments/route-settlement'

export const dynamic = 'force-dynamic'

// POST — refund again what a failed refund could not return. The failed row is locked while Razorpay is
// asked, so a double click can't refund twice.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; refundId: string }> }) {
  const { id: orderId, refundId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const tenant = await resolveRequestTenant()
    const out = await withTransaction(async client => {
      const failed = (
        await client.query(
          `SELECT r.id, r.razorpay_refund_id, r.razorpay_payment_id, r.payment_id, r.amount, r.purpose, o.order_number
             FROM payment_refunds r JOIN orders o ON o.id = r.order_id
            WHERE r.id = $1 AND r.order_id = $2 AND r.status = 'failed'
            FOR UPDATE OF r`,
          [refundId, orderId]
        )
      ).rows[0]
      if (!failed) return { error: 'Only a failed refund can be retried.', status: 404 }
      const retried = await client.query(`SELECT 1 FROM payment_refunds WHERE retry_of = $1 AND status <> 'failed' LIMIT 1`, [failed.id])
      if (retried.rowCount) return { error: 'This refund was already retried.', status: 409 }

      const paise = Math.round(Number(failed.amount) * 100)
      const { instance } = await getRazorpayInstanceFor(tenant?.tenantId)
      const refund: any = await instance.payments.refund(failed.razorpay_payment_id, {
        amount: paise,
        notes: { purpose: failed.purpose || 'refund', retry_of: failed.razorpay_refund_id },
      })
      await client.query(
        `INSERT INTO payment_refunds (razorpay_refund_id, razorpay_payment_id, payment_id, order_id, amount, status, speed_requested, purpose, initiated_by, retry_of)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'retry', $9)
         ON CONFLICT (razorpay_refund_id) DO NOTHING`,
        [refund.id, failed.razorpay_payment_id, failed.payment_id, orderId, Number(failed.amount), refund.status === 'processed' ? 'processed' : 'pending', refund.speed_requested ?? null, failed.purpose, failed.id]
      )
      return { refund, paise, failed }
    })
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })

    // The failed refund's booking was undone; this one books against the reversal already made.
    await applyRouteRefund({
      tenantId: tenant?.tenantId,
      paymentId: out.failed.razorpay_payment_id,
      refundId: out.refund.id,
      refundPaise: out.paise,
      orderRef: out.failed.order_number,
    }).catch(() => {})
    return NextResponse.json({ success: true, refundId: out.refund.id, status: out.refund.status })
  } catch (err: any) {
    return NextResponse.json({ error: err?.error?.description || err?.message || 'Refund failed' }, { status: 500 })
  }
}
