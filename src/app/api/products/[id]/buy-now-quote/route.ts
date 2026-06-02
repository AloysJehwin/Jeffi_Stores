import { NextRequest, NextResponse } from 'next/server'
import { resolveBuyNowItem } from '@/lib/order-commit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const resolved = await resolveBuyNowItem({
    productId: params.id,
    variantId: body.variantId || null,
    subVariantId: body.subVariantId || null,
    qty: Number(body.qty) || 1,
    buyMode: body.buyMode,
    buyUnit: body.buyUnit,
  })
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 })
  return NextResponse.json({
    productId: resolved.item.productId,
    variantId: resolved.item.variantId,
    subVariantId: resolved.item.subVariantId,
    qty: resolved.item.qty,
    buyMode: resolved.item.buyMode,
    buyUnit: resolved.item.buyUnit,
    price: resolved.item.price,
  })
}
