import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { getRazorpayInstance } from '@/lib/payments/razorpay'
import { topupAmounts, topupNotes } from '@/lib/billing/topup'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const body = await request.json().catch(() => ({}))
  const amountInr = Number(body?.amountInr)
  if (!(amountInr >= 100)) return NextResponse.json({ error: 'Minimum top-up is ₹100' }, { status: 400 })
  try {
    const a = topupAmounts(amountInr)
    const order = await getRazorpayInstance().orders.create({
      amount: Math.round(a.total * 100),
      currency: 'INR',
      receipt: `wtop-${ctx.tenant.id.slice(0, 8)}-${Date.now().toString(36)}`.slice(0, 40),
      notes: topupNotes(ctx.tenant, amountInr),
    })
    return NextResponse.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID, credit: a.credit, gst: a.gst, total: a.total })
  } catch (e: any) {
    return NextResponse.json({ error: e?.error?.description || e?.message || 'Could not create order' }, { status: 500 })
  }
}
