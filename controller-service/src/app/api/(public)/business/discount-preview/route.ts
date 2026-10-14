import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { getBusinessDiscountMap } from '@/lib/catalog/business-discount'
import { loadActiveCart } from '@/lib/orders/order-commit'
import { round2 } from '@/lib/catalog/gst'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authUser = await authenticateAnyUser(req)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const mode: string = body.mode === 'buyNow' ? 'buyNow' : 'cart'

  const discountMap = await getBusinessDiscountMap(authUser.userId)
  if (Object.keys(discountMap).length === 0) {
    return NextResponse.json({ businessDiscountAmount: 0 })
  }

  let businessDiscountAmount = 0

  if (mode === 'cart') {
    const cart = await loadActiveCart(authUser.userId)
    for (const item of cart) {
      const catId = item.products.category_id
      const pct = catId ? (discountMap[catId] ?? 0) : 0
      if (pct > 0) {
        const linePrice =
          Number(item.price_at_addition) ||
          Number(item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price)
        businessDiscountAmount += (linePrice * Number(item.quantity) * pct) / 100
      }
    }
  } else {
    const { productId, variantId, subVariantId, qty, price } = body
    if (!productId || !qty || !price) {
      return NextResponse.json({ businessDiscountAmount: 0 })
    }
    const productRow = await queryOne<{ category_id: string | null }>(
      `SELECT category_id FROM products WHERE id = $1`,
      [String(productId)]
    )
    if (productRow?.category_id) {
      const pct = discountMap[productRow.category_id] ?? 0
      if (pct > 0) {
        businessDiscountAmount = (Number(price) * Number(qty) * pct) / 100
      }
    }
  }

  return NextResponse.json({ businessDiscountAmount: round2(businessDiscountAmount) })
}
