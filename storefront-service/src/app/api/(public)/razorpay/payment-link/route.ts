import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { createOrderPaymentLink, PaymentLinkError } from '@/lib/payments/payment-link'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminScope(request, 'orders:write')
    if (admin instanceof NextResponse) return admin

    const { orderId, expiryHours = 48 } = await request.json()
    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })
    return NextResponse.json(await createOrderPaymentLink(orderId, expiryHours))
  } catch (err: any) {
    if (err instanceof PaymentLinkError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
