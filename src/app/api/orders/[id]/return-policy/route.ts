import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { getOrderItemsPolicy } from '@/lib/return-policy'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne<{
      id: string
      status: string
      delivered_at: Date | null
      updated_at: Date | null
    }>(
      `SELECT id, status, delivered_at, updated_at
       FROM orders
       WHERE id = $1 AND user_id = $2`,
      [id, authUser.userId]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const items = await getOrderItemsPolicy(id)

    const isDelivered = order.status === 'delivered'
    const deliveredAt = order.delivered_at || order.updated_at
    const now = new Date()

    const computeEligibility = (kind: 'refund' | 'replacement') => {
      if (!isDelivered) return { allowed: false, reason: 'Order not delivered yet' }
      if (items.length === 0) return { allowed: false, reason: 'Order has no items' }
      const blocked = items.find(p => (kind === 'refund' ? !p.return_allowed : !p.replacement_allowed))
      if (blocked) {
        return {
          allowed: false,
          reason:
            kind === 'refund'
              ? `Returns are not allowed for "${blocked.product_name}"`
              : `Replacements are not allowed for "${blocked.product_name}"`,
        }
      }
      const effectiveWindow = Math.min(
        ...items.map(p => (kind === 'refund' ? p.return_window_days : p.replacement_window_days))
      )
      if (!deliveredAt) return { allowed: false, reason: 'Delivery date unknown' }
      const cutoff = new Date(new Date(deliveredAt).getTime() + effectiveWindow * 24 * 60 * 60 * 1000)
      if (now > cutoff) {
        return {
          allowed: false,
          reason: `${kind === 'refund' ? 'Return' : 'Replacement'} window of ${effectiveWindow} day${effectiveWindow !== 1 ? 's' : ''} has closed`,
          windowDays: effectiveWindow,
          windowExpiredAt: cutoff.toISOString(),
        }
      }
      return {
        allowed: true,
        windowDays: effectiveWindow,
        windowExpiresAt: cutoff.toISOString(),
      }
    }

    return NextResponse.json({
      items,
      refund: computeEligibility('refund'),
      replacement: computeEligibility('replacement'),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
