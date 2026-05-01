import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { name } = await request.json()
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const trimmed = name.trim()
    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36)
    const sku = 'DRAFT-' + Date.now().toString(36).toUpperCase()

    const product = await queryOne<{ id: string }>(
      `INSERT INTO products (name, slug, sku, base_price, mrp, gst_percentage, stock_quantity, low_stock_threshold, is_active, is_featured, has_variants)
       VALUES ($1, $2, $3, 0, 0, 18, 0, 0, false, false, false)
       RETURNING id`,
      [trimmed, slug, sku]
    )

    if (!product) throw new Error('Insert failed')

    return NextResponse.json({ id: product.id, name: trimmed, sku })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
