import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// POST — the customer declines the proposed changes (nothing has been paid or refunded yet).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; adjId: string }> }) {
  const { id: orderId, adjId } = await params
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await queryOne(
    `UPDATE order_adjustments a SET status = 'rejected', updated_at = NOW()
       FROM orders o
      WHERE a.id = $1 AND a.order_id = $2 AND o.id = a.order_id AND (o.user_id IS NULL OR o.user_id = $3)
        AND a.status IN ('pending_customer','awaiting_payment') AND a.razorpay_payment_id IS NULL AND a.refunds = '[]'::jsonb
      RETURNING a.id`,
    [adjId, orderId, user.userId]
  )
  if (!row) return NextResponse.json({ error: 'This change can no longer be declined.' }, { status: 409 })
  return NextResponse.json({ success: true })
}
