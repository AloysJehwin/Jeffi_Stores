import { NextRequest, NextResponse } from 'next/server'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { trackOrder, TrackingError } from '@/lib/shipping/track'

async function handle(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isBusiness = authUser.isBusiness === true || request.headers.get('x-auth-portal') === 'business'

    let order: { awb_number: string | null; status: string; shipment_status: string | null } | null
    if (isBusiness) {
      const bizUser = await queryOne<{ email: string; phone: string | null }>(
        'SELECT email, phone FROM users WHERE id = $1',
        [authUser.userId]
      )
      const email = bizUser?.email || ''
      const phone = bizUser?.phone || null
      order = await queryOne(
        `SELECT awb_number, status, shipment_status FROM orders
         WHERE id = $1 AND status != 'draft' AND (
           user_id = $2 OR
           customer_email = $3 OR
           ($4::text IS NOT NULL AND customer_phone = $4)
         )`,
        [id, authUser.userId, email, phone]
      )
    } else {
      order = await queryOne(`SELECT awb_number, status, shipment_status FROM orders WHERE id = $1 AND user_id = $2`, [
        id,
        authUser.userId,
      ])
    }

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    try {
      return NextResponse.json({ tracking: await trackOrder({ id, ...order }) })
    } catch (e) {
      if (e instanceof TrackingError) return NextResponse.json({ error: e.message }, { status: e.status })
      throw e
    }
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Whatever this writes comes from the courier, not the person viewing tracking.
export const GET = (request: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  runWithAuditActor('delhivery', () => handle(request, ctx))
