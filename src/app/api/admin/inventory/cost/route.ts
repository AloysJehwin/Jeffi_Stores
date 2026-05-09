import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { product_id, variant_id, cost_price } = body

    if (!product_id) return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
    if (cost_price === undefined || cost_price === null) return NextResponse.json({ error: 'cost_price is required' }, { status: 400 })

    const cost = parseFloat(cost_price)
    if (isNaN(cost) || cost < 0) return NextResponse.json({ error: 'Invalid cost_price' }, { status: 400 })

    if (variant_id) {
      await query('UPDATE product_variants SET cost_price = $1 WHERE id = $2', [cost, variant_id])
    } else {
      await query('UPDATE products SET cost_price = $1 WHERE id = $2', [cost, product_id])
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
