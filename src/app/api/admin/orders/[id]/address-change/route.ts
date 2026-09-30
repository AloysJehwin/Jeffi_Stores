import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { parseBody, zUuid } from '@/lib/validate'
import { logActivity } from '@/lib/activity'
import { applyAddressChange, type AddressSnapshot } from '@/lib/address-change'
import { sendAddressChangeDecisionEmail } from '@/lib/address-change-email'

export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    requestId: zUuid,
    action: z.enum(['approve', 'reject']),
    adminNotes: z.string().max(1000).optional(),
  })
  .refine(d => d.action !== 'reject' || !!d.adminNotes?.trim(), {
    message: 'A reason is required to reject the request',
  })

const FAILURE_STATUS: Record<string, number> = {
  not_found: 404,
  order_not_found: 404,
  not_pending: 409,
  address_changed: 409,
  order_not_eligible: 400,
}

async function notifyCustomer(
  orderId: string,
  decision: 'approved' | 'rejected',
  newAddress: AddressSnapshot,
  adminNotes: string | null
) {
  const order = await queryOne<any>(
    `SELECT o.order_number, o.user_id, o.customer_email, o.customer_name,
            u.email AS user_email, u.first_name, u.last_name
       FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
    [orderId]
  )
  if (!order) return null
  const customerEmail = order.user_email || order.customer_email
  if (customerEmail) {
    const customerName = order.first_name
      ? `${order.first_name} ${order.last_name || ''}`.trim()
      : order.customer_name || 'Customer'
    sendAddressChangeDecisionEmail({
      customerEmail,
      customerName,
      orderNumber: order.order_number,
      orderId,
      decision,
      newAddress,
      adminNotes,
    }).catch(() => {})
  }
  return order as { order_number: string; user_id: string | null }
}

// POST /api/admin/orders/[id]/address-change — approve or reject the customer's request.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orderId } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const parsed = parseBody(bodySchema, await request.json())
    if (!parsed.ok) return parsed.response
    const { requestId, action } = parsed.data
    const adminNotes = parsed.data.adminNotes?.trim() || null

    if (action === 'approve') {
      const result = await applyAddressChange({ requestId, orderId, adminId: admin.adminId, adminNotes })
      if (!result.applied) {
        return NextResponse.json(
          { error: result.message, reason: result.reason },
          { status: FAILURE_STATUS[result.reason] ?? 400 }
        )
      }
      await notifyCustomer(orderId, 'approved', result.newAddress, adminNotes)
      if (result.userId) {
        logActivity({
          userId: result.userId,
          actorId: admin.adminId,
          kind: 'address_change',
          referenceId: orderId,
          referenceType: 'orders',
          summary: `Delivery address change approved on #${result.orderNumber}`,
          metadata: { requestId, postalCode: result.newAddress.postal_code, gstSplitChanged: result.gstSplitChanged },
        }).catch(() => {})
      }
      return NextResponse.json({ success: true, status: 'approved', gstSplitChanged: result.gstSplitChanged })
    }

    const rejected = await queryOne<{ id: string; new_address_snapshot: AddressSnapshot }>(
      `UPDATE address_change_requests
          SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), admin_notes = $2, updated_at = NOW()
        WHERE id = $3 AND order_id = $4 AND status = 'pending'
        RETURNING id, new_address_snapshot`,
      [admin.adminId, adminNotes, requestId, orderId]
    )
    if (!rejected) return NextResponse.json({ error: 'No pending address change request found.' }, { status: 404 })

    const order = await notifyCustomer(orderId, 'rejected', rejected.new_address_snapshot, adminNotes)
    if (order?.user_id) {
      logActivity({
        userId: order.user_id,
        actorId: admin.adminId,
        kind: 'address_change',
        referenceId: orderId,
        referenceType: 'orders',
        summary: `Delivery address change rejected on #${order.order_number}`,
        metadata: { requestId, reason: adminNotes },
      }).catch(() => {})
    }
    return NextResponse.json({ success: true, status: 'rejected' })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to review address change request' }, { status: 500 })
  }
}
