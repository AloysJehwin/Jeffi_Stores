import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { verifyIntent } from '@/lib/checkout-intent'
import { resolveBuyNowItem, loadActiveCart, cartSubtotal } from '@/lib/order-commit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const auth = await authenticateUser(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const intent = await verifyIntent(params.token)
  if (!intent) return NextResponse.json({ error: 'Invalid or expired intent' }, { status: 400 })

  if (intent.mode === 'cart') {
    if (intent.userId !== auth.userId) {
      return NextResponse.json({ error: 'Intent does not belong to this user' }, { status: 403 })
    }
    const cart = await loadActiveCart(auth.userId)
    if (cart.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    return NextResponse.json({
      mode: 'cart',
      itemCount: cart.length,
      subtotal: cartSubtotal(cart),
    })
  }

  const resolved = await resolveBuyNowItem({
    productId: intent.productId,
    variantId: intent.variantId,
    subVariantId: intent.subVariantId,
    qty: intent.qty,
    buyMode: intent.buyMode,
    buyUnit: intent.buyUnit,
  })
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })

  const product = await queryOne<{ id: string; name: string; slug: string }>(
    `SELECT id::text, name, slug FROM products WHERE id = $1`,
    [resolved.item.productId]
  )

  const variant = resolved.item.variantId
    ? await queryOne<{ variant_name: string }>(
        `SELECT variant_name FROM product_variants WHERE id = $1`,
        [resolved.item.variantId]
      )
    : null

  const subVariant = resolved.item.subVariantId
    ? await queryOne<{ sub_variant_name: string }>(
        `SELECT sub_variant_name FROM product_sub_variants WHERE id = $1`,
        [resolved.item.subVariantId]
      )
    : null

  return NextResponse.json({
    mode: 'buyNow',
    productId: resolved.item.productId,
    variantId: resolved.item.variantId,
    subVariantId: resolved.item.subVariantId,
    qty: resolved.item.qty,
    buyMode: resolved.item.buyMode,
    buyUnit: resolved.item.buyUnit,
    price: resolved.item.price,
    productName: product?.name || '',
    variantName: variant?.variant_name || null,
    subVariantName: subVariant?.sub_variant_name || null,
  })
}
