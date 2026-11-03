import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import { grantOrderEntitlements, revokeOrderEntitlements } from '@/lib/orders/entitlements'
import { logAdminAudit } from '@/lib/shared/admin-audit'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  action: z.enum(['revoke', 'grant']),
  orderItemIds: z.array(z.string().uuid()).max(200).optional(),
})

async function listEntitlements(orderId: string) {
  return queryMany<any>(
    `SELECT oi.id AS order_item_id, oi.product_id, oi.product_name, oi.granted_at AS item_granted_at,
            oi.access_revoked_at, ve.status, ve.granted_at, ve.revoked_at, ve.revoke_reason, ve.access_expires_at
       FROM order_items oi
       LEFT JOIN vault_entitlements ve ON ve.order_item_id = oi.id
      WHERE oi.order_id = $1 AND oi.is_digital = TRUE
      ORDER BY oi.created_at`,
    [orderId]
  )
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  try {
    return NextResponse.json({ entitlements: await listEntitlements(id) })
  } catch {
    return NextResponse.json({ error: 'Failed to load entitlements' }, { status: 500 })
  }
}

/** Revoke (all or specific digital lines) or re-grant (every digital line) vault access for an order. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { action, orderItemIds } = parsed.data

  try {
    const order = await queryOne<{ id: string; order_number: string; user_id: string | null; payment_status: string }>(
      'SELECT id, order_number, user_id, payment_status FROM orders WHERE id = $1',
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    if (action === 'grant') {
      if (!order.user_id) return NextResponse.json({ error: 'Order has no customer account' }, { status: 400 })
      if (!['paid', 'partially_refunded'].includes(order.payment_status))
        return NextResponse.json({ error: 'Access can only be granted on a paid order' }, { status: 400 })
    }

    const count = await withTransaction(client =>
      action === 'grant'
        ? grantOrderEntitlements(client, { orderId: id, userId: order.user_id as string })
        : revokeOrderEntitlements(client, { orderId: id, orderItemIds, reason: 'admin' })
    )

    await logAdminAudit({
      adminId: admin.adminId,
      action: 'update',
      entityType: 'order',
      entityId: id,
      summary: `${action === 'grant' ? 'Re-granted' : 'Revoked'} vault access on ${order.order_number} (${count} line${count === 1 ? '' : 's'})`,
      metadata: { orderItemIds: orderItemIds ?? null },
      request,
    }).catch(() => {})

    return NextResponse.json({ success: true, count, entitlements: await listEntitlements(id) })
  } catch {
    return NextResponse.json({ error: 'Failed to update access' }, { status: 500 })
  }
}
