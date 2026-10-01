import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// POST /api/admin/orders/[id]/variant-change/[vcrId]/cancel — admin withdraws a pending request.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; vcrId: string }> }) {
  try {
    const { id: orderId, vcrId } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const vcr = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM variant_change_requests WHERE id = $1 AND order_id = $2`,
      [vcrId, orderId]
    )
    if (!vcr) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    if (vcr.status === 'applied')
      return NextResponse.json({ error: 'This change has already been applied.' }, { status: 400 })
    if (vcr.status === 'cancelled' || vcr.status === 'rejected') {
      return NextResponse.json({ success: true, alreadyClosed: true })
    }

    await queryOne(
      `UPDATE variant_change_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [vcrId]
    )
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to cancel request' }, { status: 500 })
  }
}
