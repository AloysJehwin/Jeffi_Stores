import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryOne } from '@/lib/shared/db'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { parseBody, zUuid } from '@/lib/shared/validate'
import { loadCustomerSubscriptions } from '@/lib/subscriptions/customer'
import {
  SubscriptionError,
  cancelSubscription,
  changeSubscriptionAddress,
  pauseSubscription,
  resumeSubscription,
} from '@/lib/subscriptions/service'

const ActionSchema = z.object({
  action: z.enum(['cancel', 'pause', 'resume', 'address']),
  addressId: zUuid.nullish(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    if (!zUuid.safeParse(id).success) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })

    const parsed = parseBody(ActionSchema, await request.json().catch(() => null))
    if (!parsed.ok) return parsed.response
    const { action, addressId } = parsed.data

    const owned = await queryOne<{ id: string }>(
      `SELECT id FROM subscriptions WHERE id = $1 AND user_id = $2 AND COALESCE(source, 'legacy') <> 'legacy'`,
      [id, user.userId]
    )
    if (!owned) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })

    if (action === 'cancel') await cancelSubscription(id, { atCycleEnd: true, actor: 'customer' })
    else if (action === 'pause') await pauseSubscription(id, 'customer')
    else if (action === 'resume') await resumeSubscription(id)
    else {
      if (!addressId) return NextResponse.json({ error: 'addressId is required' }, { status: 400 })
      await changeSubscriptionAddress(id, user.userId, addressId)
    }

    const [subscription] = await loadCustomerSubscriptions(user.userId, id)
    return NextResponse.json({ subscription })
  } catch (err) {
    if (err instanceof SubscriptionError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[user/subscriptions/:id]', err)
    return NextResponse.json({ error: 'Could not update subscription' }, { status: 500 })
  }
}
