import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { parseBody, zUuid } from '@/lib/shared/validate'
import { deriveSubscriptionOffer } from '@/lib/subscriptions/offer'
import { SubscriptionError } from '@/lib/subscriptions/types'

const QuoteSchema = z.object({
  productId: zUuid,
  variantId: zUuid.nullish(),
  subVariantId: zUuid.nullish(),
  interval: z.string(),
  quantity: z.coerce.number().default(1),
  addressId: zUuid.nullish(),
})

export async function POST(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = parseBody(QuoteSchema, await request.json().catch(() => null))
    if (!parsed.ok) return parsed.response
    const b = parsed.data

    const offer = await deriveSubscriptionOffer({
      userId: user.userId,
      productId: b.productId,
      variantId: b.variantId,
      subVariantId: b.subVariantId,
      interval: b.interval,
      quantity: b.quantity,
      addressId: b.addressId,
    })
    return NextResponse.json({
      productName: offer.product.name,
      unitPrice: offer.unitPrice,
      oneTimePrice: offer.oneTimePrice,
      quantity: offer.quantity,
      shipping: offer.shipping,
      amount: offer.amount,
      interval: offer.interval,
      intervalLabel: offer.intervalLabel,
      totalCycles: offer.totalCycles,
      minCycles: offer.minCycles,
      isDigital: offer.isDigital,
      collectingAccount: offer.collectingAccount,
      merchantLabel: offer.merchantLabel,
    })
  } catch (err) {
    if (err instanceof SubscriptionError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[subscriptions/quote]', err)
    return NextResponse.json({ error: 'Could not quote subscription' }, { status: 500 })
  }
}
