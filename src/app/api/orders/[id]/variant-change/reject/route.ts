import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'
import { logActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'

// POST /api/orders/[id]/variant-change/reject — customer declines the proposed swap.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orderId } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const vcr = await queryOne<any>(
      `SELECT vcr.id, vcr.status, o.user_id, o.order_number
       FROM variant_change_requests vcr JOIN orders o ON o.id = vcr.order_id
       WHERE vcr.order_id = $1 AND vcr.status IN ('pending_customer','awaiting_payment')
       ORDER BY vcr.created_at DESC LIMIT 1`,
      [orderId]
    )
    if (!vcr) return NextResponse.json({ error: 'No pending variant change request for this order.' }, { status: 404 })
    if (vcr.user_id && vcr.user_id !== authUser.userId) {
      return NextResponse.json({ error: 'This order does not belong to you.' }, { status: 403 })
    }

    await query(`UPDATE variant_change_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [vcr.id])
    if (vcr.user_id) {
      logActivity({
        userId: vcr.user_id,
        kind: 'variant_change',
        referenceId: orderId,
        referenceType: 'orders',
        summary: `Customer declined the variant change on #${vcr.order_number}`,
        metadata: { vcrId: vcr.id, rejected: true },
      }).catch(() => {})
    }
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to reject variant change' }, { status: 500 })
  }
}
