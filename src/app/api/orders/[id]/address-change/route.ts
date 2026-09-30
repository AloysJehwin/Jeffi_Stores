import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { parseBody, zUuid } from '@/lib/validate'
import { checkPincodeServiceability } from '@/lib/delhivery'
import { logActivity } from '@/lib/activity'
import { createAdminNotification } from '@/lib/admin-notify'
import { addressChangeBlockReason, snapshotAddress, sameAddress, ADDRESS_SNAPSHOT_COLUMNS } from '@/lib/address-change'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ addressId: zUuid })

// Ownership mirrors GET /api/orders/[id]: whoever can open the order can ask to change it.
async function loadOwnedOrder(request: NextRequest, orderId: string, userId: string, isBusinessUser: boolean) {
  const select = `
    SELECT o.id, o.order_number, o.user_id, o.status, o.awb_number, o.irn, o.irn_status, o.eway_bill_no,
           o.payment_mode, o.payment_status, o.shipping_address_id, o.customer_name,
           COALESCE(
             o.shipping_address_snapshot,
             (SELECT to_jsonb(a) FROM (SELECT ${ADDRESS_SNAPSHOT_COLUMNS} FROM addresses WHERE id = o.shipping_address_id) a)
           ) AS current_address
      FROM orders o`
  const isBusiness = isBusinessUser || request.headers.get('x-auth-portal') === 'business'
  if (!isBusiness) {
    return queryOne<any>(`${select} WHERE o.id = $1 AND o.status != 'draft' AND o.user_id = $2`, [orderId, userId])
  }
  const biz = await queryOne<{ email: string; phone: string | null }>('SELECT email, phone FROM users WHERE id = $1', [
    userId,
  ])
  return queryOne<any>(
    `${select} WHERE o.id = $1 AND o.status != 'draft' AND (
       o.user_id = $2 OR
       (o.source = 'business' AND (o.customer_email = $3 OR ($4::text IS NOT NULL AND o.customer_phone = $4)))
     )`,
    [orderId, userId, biz?.email || '', biz?.phone || null]
  )
}

// POST /api/orders/[id]/address-change — customer asks to deliver a confirmed order elsewhere.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orderId } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = parseBody(bodySchema, await request.json())
    if (!parsed.ok) return parsed.response
    const { addressId } = parsed.data

    const order = await loadOwnedOrder(request, orderId, authUser.userId, authUser.isBusiness === true)
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const blocked = addressChangeBlockReason(order)
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 })

    const address = await queryOne<any>(
      `SELECT id, ${ADDRESS_SNAPSHOT_COLUMNS} FROM addresses WHERE id = $1 AND user_id = $2`,
      [addressId, authUser.userId]
    )
    if (!address) return NextResponse.json({ error: 'Address not found' }, { status: 404 })

    const newAddress = snapshotAddress(address)
    if (sameAddress(newAddress, order.current_address)) {
      return NextResponse.json({ error: 'This is already the delivery address for this order.' }, { status: 400 })
    }

    // Same gate checkout applies, so an address change cannot route around it.
    if (String(newAddress.postal_code) !== String(order.current_address?.postal_code ?? '')) {
      const service = await checkPincodeServiceability(newAddress.postal_code)
      if (!service.serviceable) {
        return NextResponse.json(
          { error: service.error || 'Delivery is not available to this pincode.', unserviceable: true },
          { status: 422 }
        )
      }
      const isCod = order.payment_mode === 'cod' || String(order.payment_status || '').startsWith('cod')
      if (isCod && !service.cod) {
        return NextResponse.json({ error: 'Cash on delivery is not available to this pincode.' }, { status: 422 })
      }
    }

    let created: { id: string; created_at: string } | null
    try {
      created = await queryOne<{ id: string; created_at: string }>(
        `INSERT INTO address_change_requests
           (order_id, requested_by_user_id, old_address_id, new_address_id, old_address_snapshot, new_address_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [
          orderId,
          authUser.userId,
          order.shipping_address_id ?? null,
          address.id,
          order.current_address ? JSON.stringify(snapshotAddress(order.current_address)) : null,
          JSON.stringify(newAddress),
        ]
      )
    } catch (err: any) {
      if (err?.code === '23505') {
        return NextResponse.json(
          { error: 'An address change request is already pending for this order.' },
          { status: 409 }
        )
      }
      throw err
    }

    logActivity({
      userId: authUser.userId,
      kind: 'address_change',
      referenceId: orderId,
      referenceType: 'orders',
      summary: `Delivery address change requested for #${order.order_number}`,
      metadata: { requestId: created?.id, postalCode: newAddress.postal_code },
    }).catch(() => {})

    createAdminNotification({
      type: 'address_change_requested',
      category: 'orders',
      title: `Address change — #${order.order_number}`,
      message: `${order.customer_name || 'Customer'} asked to deliver to ${newAddress.city}, ${newAddress.state} ${newAddress.postal_code}`,
      link: `/admin/orders/${orderId}`,
      entityType: 'address_change',
      entityId: String(created?.id),
      severity: 'warning',
      scope: 'orders:read',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      request: { id: created?.id, status: 'pending', newAddress, adminNotes: null, createdAt: created?.created_at },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to request address change' }, { status: 500 })
  }
}

// DELETE /api/orders/[id]/address-change — customer withdraws their own pending request.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orderId } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const withdrawn = await queryOne<{ id: string }>(
      `UPDATE address_change_requests SET status = 'cancelled', updated_at = NOW()
        WHERE order_id = $1 AND status = 'pending' AND requested_by_user_id = $2
        RETURNING id`,
      [orderId, authUser.userId]
    )
    if (!withdrawn)
      return NextResponse.json({ error: 'No pending address change request for this order.' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to withdraw address change request' }, { status: 500 })
  }
}
