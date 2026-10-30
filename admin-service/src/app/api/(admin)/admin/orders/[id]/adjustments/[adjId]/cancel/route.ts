import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { closeReplyContexts } from '@/lib/replies/context'

export const dynamic = 'force-dynamic'

// POST — withdraw an adjustment the customer hasn't paid for or approved yet.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; adjId: string }> }) {
  const { id: orderId, adjId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const row = await queryOne(
    `UPDATE order_adjustments SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND order_id = $2 AND status IN ('pending_customer','awaiting_payment') AND razorpay_payment_id IS NULL
      RETURNING id`,
    [adjId, orderId]
  )
  if (!row) return NextResponse.json({ error: 'This change can no longer be cancelled.' }, { status: 409 })
  await closeReplyContexts('orders', orderId, 'order_adjustment')
  return NextResponse.json({ success: true })
}
