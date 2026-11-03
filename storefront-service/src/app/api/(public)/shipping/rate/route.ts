import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody, zIndianPin, zCurrency } from '@/lib/shared/validate'
import { computeShippingRate } from '@/lib/shipping/shipping-rate'

const postSchema = z.object({
  destinationPin: zIndianPin,
  cartItems: z.array(z.unknown()).min(1, 'cartItems must have at least one item'),
  subtotal: zCurrency.optional(),
})

export async function POST(request: NextRequest) {
  try {
    const { destinationPin, cartItems, subtotal, isCod } = await request.json()

    if (!destinationPin || !/^\d{6}$/.test(destinationPin)) {
      return NextResponse.json({ error: 'Invalid destination pincode' }, { status: 400 })
    }

    const parsed = parseBody(postSchema, { destinationPin, cartItems, subtotal })
    if (!parsed.ok) return parsed.response

    const result = await computeShippingRate({ destinationPin, cartItems, subtotal, isCod })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'No valid cart items') {
      return NextResponse.json({ error: 'No valid cart items' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
