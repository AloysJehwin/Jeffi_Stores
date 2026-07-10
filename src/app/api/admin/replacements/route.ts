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
    const status = searchParams.get('status') || 'active'

    let statusFilter = `o.status NOT IN ('returned', 'cancelled', 'return_rejected')`
    if (status === 'delivered') statusFilter = `o.status = 'delivered'`
    else if (status === 'all') statusFilter = `1=1`

    const rows = await queryMany(
      `SELECT
         o.id, o.order_number, o.status, o.payment_status,
         o.total_amount, o.created_at, o.shipped_at, o.delivered_at,
         o.awb_number, o.shipment_status,
         o.customer_name, o.customer_email,
         o.original_order_id,
         orig.order_number AS original_order_number,
         u.first_name, u.last_name, u.email AS user_email,
         rr.id AS return_request_id, rr.type AS return_type, rr.reason,
         COALESCE(
           (SELECT json_agg(json_build_object(
             'id', oi.id,
             'product_name', oi.product_name,
             'variant_name', oi.variant_name,
             'quantity', oi.quantity,
             'unit_price', oi.unit_price,
             'total_price', oi.total_price
           ) ORDER BY oi.created_at)
           FROM order_items oi WHERE oi.order_id = o.id),
           '[]'::json
         ) AS items
       FROM orders o
       JOIN orders orig ON orig.id = o.original_order_id
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN return_requests rr ON rr.replacement_order_id = o.id
       WHERE o.original_order_id IS NOT NULL
         AND ${statusFilter}
       ORDER BY o.created_at DESC`,
      []
    )

    return NextResponse.json({ replacements: rows })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to fetch replacements' }, { status: 500 })
  }
}
