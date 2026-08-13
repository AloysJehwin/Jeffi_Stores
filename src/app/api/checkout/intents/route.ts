import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { resolveBuyNowItem, loadActiveCart } from '@/lib/order-commit'
import { signIntent } from '@/lib/checkout-intent'
import { getFeatureFlags } from '@/lib/site-controls'
import { parseBody, zUuid } from '@/lib/validate'

const IntentSchema = z.object({
  mode: z.string().optional(),
  productId: zUuid.optional(),
  variantId: zUuid.nullish(),
  subVariantId: zUuid.nullish(),
  qty: z.number().positive().optional(),
  buyMode: z.string().nullish(),
  buyUnit: z.string().nullish(),
  addressId: zUuid.optional(),
  shippingCharge: z.number().min(0).optional(),
})

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const parsed = parseBody(IntentSchema, body)
  if (!parsed.ok) return parsed.response
  const mode = parsed.data.mode === 'cart' ? 'cart' : 'buyNow'

  if (mode === 'cart') {
    const auth = await authenticateUser(req)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const cart = await loadActiveCart(auth.userId)
    if (cart.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    const token = await signIntent({
      mode: 'cart',
      userId: auth.userId,
      ...(parsed.data.addressId != null && { addressId: parsed.data.addressId }),
      ...(parsed.data.shippingCharge != null && { shippingCharge: parsed.data.shippingCharge }),
    })
    return NextResponse.json({ intent: token })
  }

  if (!parsed.data.productId || !parsed.data.qty) {
    return NextResponse.json({ error: 'productId and qty required' }, { status: 400 })
  }

  const { gstEnabled } = await getFeatureFlags()
  const resolved = await resolveBuyNowItem({
    productId: parsed.data.productId,
    variantId: parsed.data.variantId ?? null,
    subVariantId: parsed.data.subVariantId ?? null,
    qty: parsed.data.qty,
    buyMode: parsed.data.buyMode ?? undefined,
    buyUnit: parsed.data.buyUnit ?? null,
    gstEnabled,
  })
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })

  const token = await signIntent({
    mode: 'buyNow',
    productId: resolved.item.productId,
    variantId: resolved.item.variantId,
    subVariantId: resolved.item.subVariantId,
    qty: resolved.item.qty,
    buyMode: resolved.item.buyMode as 'unit' | 'weight' | 'length',
    buyUnit: resolved.item.buyUnit,
  })

  return NextResponse.json({ intent: token })
}
