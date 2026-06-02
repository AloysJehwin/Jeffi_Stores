import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { resolveBuyNowItem, loadActiveCart } from '@/lib/order-commit'
import { signIntent } from '@/lib/checkout-intent'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await authenticateUser(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const mode = body.mode === 'cart' ? 'cart' : 'buyNow'

  if (mode === 'cart') {
    const cart = await loadActiveCart(auth.userId)
    if (cart.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    const token = await signIntent({ mode: 'cart', userId: auth.userId })
    return NextResponse.json({ intent: token })
  }

  if (!body.productId || !body.qty) {
    return NextResponse.json({ error: 'productId and qty required' }, { status: 400 })
  }

  const resolved = await resolveBuyNowItem({
    productId: String(body.productId),
    variantId: body.variantId || null,
    subVariantId: body.subVariantId || null,
    qty: Number(body.qty),
    buyMode: body.buyMode,
    buyUnit: body.buyUnit,
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
