import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'all'

    let statusFilter = `rr.status NOT IN ('rejected', 'completed')`
    if (status === 'pending_approval') statusFilter = `rr.status = 'pending_approval'`
    else if (status === 'approved') statusFilter = `rr.status = 'approved'`
    else if (status === 'received') statusFilter = `rr.status = 'received'`

    const rows = await queryMany(
      `SELECT
         rr.id, rr.order_id, rr.type, rr.status, rr.reason, rr.description,
         rr.admin_notes, rr.return_tracking_number, rr.rvp_awb_number, rr.rvp_created_at,
         rr.received_at, rr.image_urls, rr.valuation_status, rr.valuation_condition,
         rr.valuation_notes, rr.valuated_at, rr.created_at,
         o.order_number, o.customer_name, o.customer_email, o.total_amount,
         u.first_name, u.last_name, u.email AS user_email
       FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
       LEFT JOIN users u ON u.id = rr.user_id
       WHERE ${statusFilter}
       ORDER BY rr.created_at DESC`,
      []
    )

    return NextResponse.json({ returns: rows })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to fetch returns' }, { status: 500 })
  }
}
