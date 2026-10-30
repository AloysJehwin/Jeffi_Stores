import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { parseBody, zNonEmpty } from '@/lib/shared/validate'
import { verifySubscriptionPayment } from '@/lib/subscriptions/verify'
import { SubscriptionError } from '@/lib/subscriptions/types'

const VerifySchema = z.object({
  razorpay_payment_id: zNonEmpty,
  razorpay_subscription_id: zNonEmpty,
  razorpay_signature: zNonEmpty,
})

export async function POST(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = parseBody(VerifySchema, await request.json().catch(() => null))
    if (!parsed.ok) return parsed.response

    return NextResponse.json(await verifySubscriptionPayment({ userId: user.userId, ...parsed.data }))
  } catch (err) {
    if (err instanceof SubscriptionError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[subscriptions/verify]', err)
    return NextResponse.json({ error: 'Subscription verification failed' }, { status: 500 })
  }
}
