import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { getRazorpayInstance } from '@/lib/payments/razorpay'
import { creditTopup } from '@/lib/billing/topup'
import { startStoreIfReady } from '@controller/lib/provisioning/start-store'

export const dynamic = 'force-dynamic'

// Same contract as the admin top-up verify: signature check, amount from the Razorpay order, idempotent on payment id.
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const b = await request.json().catch(() => ({}))
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = b ?? {}
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return NextResponse.json({ error: 'Missing payment fields' }, { status: 400 })
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) return NextResponse.json({ error: 'Payments not configured' }, { status: 400 })
  const expected = crypto.createHmac('sha256', secret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex')
  if (expected !== razorpay_signature) return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
  const order = await getRazorpayInstance().orders.fetch(razorpay_order_id)
  if (order?.notes?.purpose !== 'wallet_topup' || order?.notes?.tenant_id !== ctx.tenant.id) return NextResponse.json({ error: 'Order does not belong to this wallet' }, { status: 400 })
  const r = await creditTopup({ tenantId: ctx.tenant.id, paymentId: razorpay_payment_id, paidPaise: Number(order.amount_paid || order.amount), notes: order.notes as any })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  // A new store waiting on its servers' prepayment starts now.
  const started = await startStoreIfReady(ctx.tenant.id).catch(() => false)
  return NextResponse.json({ ok: true, balance: r.balance, started })
}
