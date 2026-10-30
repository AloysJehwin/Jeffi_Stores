import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { getProductCardsByIds, cardPropsFor } from '@/lib/catalog/product-cards'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

export const dynamic = 'force-dynamic'

const LIMIT = 12

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAnyUser(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rows = await queryMany<{ product_id: string }>(
      `SELECT oi.product_id
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id AND p.is_active = true
        WHERE o.user_id = $1
          AND o.status NOT IN ('draft', 'cancelled', 'cancel_requested')
        GROUP BY oi.product_id
        ORDER BY MAX(o.created_at) DESC, oi.product_id
        LIMIT $2`,
      [auth.userId, LIMIT]
    )
    if (rows.length === 0) return NextResponse.json({ products: [] })

    const { gstEnabled } = await getFeatureFlags()
    const cards = await getProductCardsByIds(
      rows.map(r => r.product_id),
      gstEnabled
    )
    return NextResponse.json({ products: cardPropsFor(cards, gstEnabled) })
  } catch (err) {
    console.error('[account/buy-again]', err)
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 })
  }
}
