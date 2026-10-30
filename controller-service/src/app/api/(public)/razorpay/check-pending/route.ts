import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryOne, resolveRequestTenant } from '@/lib/shared/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { verifyDraftToken } from '@/lib/orders/order-draft'
import { commitDraftFromCapture } from '@/lib/payments/capture'
import { parseBody, zNonEmpty } from '@/lib/shared/validate'

const Schema = z.object({
  razorpayOrderId: zNonEmpty,
  draftToken: zNonEmpty,
})

const orderFor = (rzpOrderId: string) =>
  queryOne<{ id: string; order_number: string }>(
    `SELECT o.id, o.order_number FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE p.gateway_response->>'razorpay_order_id' = $1 LIMIT 1`,
    [rzpOrderId]
  )

/** The checkout asks after a payment whose browser never reached verify; creates the order if it was paid. */
export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = parseBody(Schema, body)
    if (!parsed.ok) return parsed.response
    const { razorpayOrderId, draftToken } = parsed.data

    const draft = await verifyDraftToken(draftToken)
    if (!draft) return NextResponse.json({ error: 'Invalid or expired checkout session' }, { status: 400 })
    if (draft.userId !== authUser.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    // Verify or the webhook may already have made the order.
    const existing = await orderFor(razorpayOrderId)
    if (existing) return NextResponse.json({ order: { id: existing.id, orderNumber: existing.order_number } })

    // A store on its own Razorpay account made the order there.
    const tenant = await resolveRequestTenant()
    const { instance: razorpay } = await getRazorpayInstanceFor(tenant?.tenantId)
    const rzpOrder = await (razorpay.orders as any).fetch(razorpayOrderId)

    if (rzpOrder.status === 'paid') {
      const payments = await (razorpay.orders as any).fetchPayments(razorpayOrderId)
      const captured = payments?.items?.find((p: any) => p.status === 'captured')
      if (!captured) return NextResponse.json({ status: 'pending', error: 'Payment processing — please wait.' })

      const r = await commitDraftFromCapture(razorpayOrderId, captured, tenant, { via: 'payment recovery' })
      if (r.status === 'committed') return NextResponse.json({ order: { id: r.order.id, orderNumber: r.order.order_number } })
      if (r.status === 'needs_action') {
        return NextResponse.json(
          { error: `${r.reason}. Our team will create your order or refund you — payment ID: ${captured.id}` },
          { status: 409 }
        )
      }
      // The webhook claimed it first; give it a moment to finish.
      await new Promise(res => setTimeout(res, 1000))
      const committed = await orderFor(razorpayOrderId)
      if (committed) return NextResponse.json({ order: { id: committed.id, orderNumber: committed.order_number } })
      return NextResponse.json({ status: 'pending', error: 'Payment is being processed. Check My Orders shortly.' })
    }

    if (rzpOrder.status === 'created' || rzpOrder.status === 'attempted') {
      return NextResponse.json({ status: 'pending', error: 'Payment not yet completed.' })
    }
    return NextResponse.json({ status: 'not_paid', error: 'Payment was not completed. Your cart has been restored.' })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not check payment status' }, { status: 500 })
  }
}
