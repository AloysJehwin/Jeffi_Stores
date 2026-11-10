import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { parseBody, zUuid } from '@/lib/shared/validate'
import { createCustomerSubscription } from '@/lib/subscriptions/create'
import { createAutopaySubscription } from '@/lib/subscriptions/autopay'
import { SubscriptionError } from '@/lib/subscriptions/types'

const CreateSchema = z.object({
  productId: zUuid,
  variantId: zUuid.nullish(),
  subVariantId: zUuid.nullish(),
  interval: z.string(),
  quantity: z.coerce.number().default(1),
  addressId: zUuid,
  consent: z.literal(true, { message: 'Please accept the auto-debit terms' }),
  /** 'upi_autopay' = PhonePe Autopay mandate (stores whose UPI provider is PhonePe). */
  method: z.enum(['razorpay', 'upi_autopay']).optional(),
})

function originOf(request: NextRequest): string {
  const first = (v: string | null) => (v ?? '').split(',')[0].trim()
  const host = first(request.headers.get('x-forwarded-host')) || first(request.headers.get('host')) || request.nextUrl.host
  const proto = first(request.headers.get('x-forwarded-proto')) || (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = parseBody(CreateSchema, await request.json().catch(() => null))
    if (!parsed.ok) return parsed.response
    const b = parsed.data

    if (b.method === 'upi_autopay') {
      const isBusiness = user.isBusiness === true || request.headers.get('x-auth-portal') === 'business'
      const base = `${originOf(request)}${isBusiness ? '/business' : ''}/subscribe/return`
      const started = await createAutopaySubscription({
        userId: user.userId,
        productId: b.productId,
        variantId: b.variantId,
        subVariantId: b.subVariantId,
        interval: b.interval,
        quantity: b.quantity,
        addressId: b.addressId,
        returnUrl: id => `${base}?sub=${id}`,
      })
      return NextResponse.json(started)
    }

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
