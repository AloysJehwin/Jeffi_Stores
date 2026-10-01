import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { verifyIntent } from '@/lib/orders/checkout-intent'
import { resolveBuyNowItem, loadActiveCart, cartSubtotal } from '@/lib/orders/order-commit'
import { getBusinessDiscountMap } from '@/lib/catalog/business-discount'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { round2 } from '@/lib/catalog/gst'

interface ProductDisplay {
  name: string
  sku: string | null
  mrp: number | null
  gst_percentage: number | null
  brand_name: string | null
  category_id: string | null
  extra_delivery_days: number | null
  variant_name: string | null
  variant_sku: string | null
  variant_mrp: number | null
  sub_variant_name: string | null
  sub_variant_sku: string | null
  sub_variant_mrp: number | null
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const intent = await verifyIntent(token)
  if (!intent) return NextResponse.json({ error: 'Invalid or expired intent' }, { status: 400 })
  const { gstEnabled } = await getFeatureFlags()

  if (intent.mode === 'cart') {
    const auth = await authenticateAnyUser(req)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (intent.userId !== auth.userId) {
      return NextResponse.json({ error: 'Intent does not belong to this user' }, { status: 403 })
    }
    const cart = await loadActiveCart(auth.userId)
    if (cart.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    return NextResponse.json({
      mode: 'cart',
      itemCount: cart.length,
      subtotal: cartSubtotal(cart, gstEnabled),
      addressId: (intent as any).addressId ?? null,
      shippingCharge: (intent as any).shippingCharge ?? null,
    })
  }

  const resolved = await resolveBuyNowItem({
    productId: intent.productId,
    variantId: intent.variantId,
    subVariantId: intent.subVariantId,
    qty: intent.qty,
    buyMode: intent.buyMode,
    buyUnit: intent.buyUnit,
    gstEnabled,
  })
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })

  const display = await queryOne<ProductDisplay>(
    `SELECT
       p.name, p.sku, p.mrp::float AS mrp,
       p.gst_percentage::float AS gst_percentage,
       p.category_id,
       p.extra_delivery_days,
       b.name AS brand_name,
       pv.variant_name, pv.sku AS variant_sku, pv.mrp::float AS variant_mrp,
       psv.sub_variant_name, psv.sku AS sub_variant_sku, psv.mrp::float AS sub_variant_mrp
     FROM products p
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN product_variants pv ON pv.id = $2
     LEFT JOIN product_sub_variants psv ON psv.id = $3
     WHERE p.id = $1`,
    [resolved.item.productId, resolved.item.variantId ?? null, resolved.item.subVariantId ?? null]
  )

  const sku = display?.sub_variant_sku || display?.variant_sku || display?.sku || null
  const mrp = display?.sub_variant_mrp ?? display?.variant_mrp ?? display?.mrp ?? null

  // Compute business discount for authenticated users
  let businessDiscount = 0
  const auth = await authenticateAnyUser(req)
  if (auth && display?.category_id) {
    const bizMap = await getBusinessDiscountMap(auth.userId)
    const pct = bizMap[display.category_id] ?? 0
    if (pct > 0) {
      businessDiscount = round2((resolved.item.price * resolved.item.qty * pct) / 100)
    }
  }

  return NextResponse.json({
    mode: 'buyNow',
    productId: resolved.item.productId,
    variantId: resolved.item.variantId,
    subVariantId: resolved.item.subVariantId,
    qty: resolved.item.qty,
    buyMode: resolved.item.buyMode,
    buyUnit: resolved.item.buyUnit,
    price: resolved.item.price,
    productName: display?.name || '',
    variantName: display?.variant_name || null,
    subVariantName: display?.sub_variant_name || null,
    sku,
    mrp,
    gstPercentage: display?.gst_percentage ?? null,
    brandName: display?.brand_name || null,
    extraDeliveryDays: display?.extra_delivery_days ?? 0,
    businessDiscount,
  })
}
