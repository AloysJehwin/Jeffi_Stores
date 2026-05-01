import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim() || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)

    const rows = await queryMany(
      `SELECT p.id, p.name, p.sku, p.slug, p.mrp, p.sale_price, p.base_price, p.gtin,
              b.name AS brand_name
       FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.is_active = true
         AND ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE '%' || $1 || '%')
       ORDER BY p.name ASC
       LIMIT $2`,
      [q, limit]
    )

    return NextResponse.json({ products: rows || [] })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
