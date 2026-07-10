import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { logActivity } from '@/lib/activity'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { condition, notes, restock } = await request.json()

    if (!['good', 'defective', 'damaged'].includes(condition)) {
      return NextResponse.json({ error: 'Invalid condition. Must be good, defective, or damaged.' }, { status: 400 })
    }

    const returnRequest = await queryOne<any>(
      `SELECT rr.*, o.order_number, o.user_id
       FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
       WHERE rr.id = $1 AND rr.status = 'received'`,
      [id]
    )

    if (!returnRequest) {
      return NextResponse.json({ error: 'Return request not found or not in received state' }, { status: 404 })
    }

    if (returnRequest.valuation_status === 'approved') {
      return NextResponse.json({ error: 'Valuation already completed' }, { status: 409 })
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE return_requests
         SET valuation_status = 'approved',
             valuation_condition = $1,
             valuation_notes = $2,
             valuated_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [condition, notes?.trim() || null, id]
      )
    })

    if (returnRequest.user_id) {
      logActivity({
        userId: returnRequest.user_id,
        actorId: admin.adminId,
        kind: 'return_status',
        referenceId: returnRequest.order_id,
        referenceType: 'orders',
        summary: `Return valuation completed for #${returnRequest.order_number}: ${condition}${restock !== false ? ', restock' : ', no restock'}`,
        metadata: { condition, notes: notes?.trim() || null, restock },
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, condition, restock })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to save valuation' }, { status: 500 })
  }
}
