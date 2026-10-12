import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@/lib/ecom/owner-api'
import { getRazorpayInstance } from '@/lib/payments/razorpay'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const body = await request.json().catch(() => ({}))
  const amountInr = Number(body?.amountInr)
  if (!(amountInr >= 100)) return NextResponse.json({ error: 'Minimum top-up is ₹100' }, { status: 400 })
  try {
    const order = await getRazorpayInstance().orders.create({
      amount: Math.round(amountInr * 100),
      currency: 'INR',
      receipt: `wtop-${ctx.tenant.id.slice(0, 8)}-${Date.now().toString(36)}`.slice(0, 40),
      notes: { purpose: 'wallet_topup', tenant_id: ctx.tenant.id, tenant_slug: ctx.tenant.slug },
    })
    return NextResponse.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID })
  } catch (e: any) {
    return NextResponse.json({ error: e?.error?.description || e?.message || 'Could not create order' }, { status: 500 })
  }
}
