import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { confirmAdjustment } from '@/lib/orders/adjustment-decision'

export const dynamic = 'force-dynamic'

// POST — the customer accepts the proposed changes (see lib/orders/adjustment-decision.ts).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; adjId: string }> }) {
  const { id: orderId, adjId } = await params
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const r = await confirmAdjustment(adjId, orderId, user.userId)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    if (r.settlement === 'collect') {
      return NextResponse.json({ success: true, settlement: 'collect', razorpayOrderId: r.razorpayOrderId, amount: r.amount, currency: r.currency, key_id: r.keyId })
    }
    return NextResponse.json({ success: true, settlement: r.settlement })
  } catch (err: any) {
    return NextResponse.json({ error: err?.error?.description || err?.message || 'Failed to confirm the change' }, { status: 500 })
  }
}
