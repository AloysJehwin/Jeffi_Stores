import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { parseBody, zUuid } from '@/lib/shared/validate'
import { createCustomerSubscription } from '@/lib/subscriptions/create'
import { SubscriptionError } from '@/lib/subscriptions/types'

const CreateSchema = z.object({
  productId: zUuid,
  variantId: zUuid.nullish(),
  subVariantId: zUuid.nullish(),
  interval: z.string(),
  quantity: z.coerce.number().default(1),
  addressId: zUuid,
  consent: z.literal(true, { message: 'Please accept the auto-debit terms' }),
})

export async function POST(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = parseBody(CreateSchema, await request.json().catch(() => null))
    if (!parsed.ok) return parsed.response
    const b = parsed.data

    const result = await createCustomerSubscription({
      userId: user.userId,
      productId: b.productId,
      variantId: b.variantId,
      subVariantId: b.subVariantId,
      interval: b.interval,
      quantity: b.quantity,
      addressId: b.addressId,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof SubscriptionError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[subscriptions/create]', err)
    return NextResponse.json({ error: 'Could not start subscription' }, { status: 500 })
  }
}
