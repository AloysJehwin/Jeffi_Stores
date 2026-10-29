import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { parseBody, zUuid } from '@/lib/shared/validate'
import { ORDER_ADDRESS_SELECT, submitAddressChange } from '@/lib/orders/address-change-request'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ addressId: zUuid })

// Ownership mirrors GET /api/orders/[id]: whoever can open the order can ask to change it.
async function loadOwnedOrder(request: NextRequest, orderId: string, userId: string, isBusinessUser: boolean) {
  const select = ORDER_ADDRESS_SELECT
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

    const r = await submitAddressChange(order, addressId, authUser.userId)
    if (!r.ok) return NextResponse.json({ error: r.error, ...(r.unserviceable ? { unserviceable: true } : {}) }, { status: r.status })
    return NextResponse.json({ success: true, request: r.request })
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
