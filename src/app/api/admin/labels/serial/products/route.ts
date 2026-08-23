import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { buildProductSearchClause, buildProductSearchRank } from '@/lib/search'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/admin/labels/serial/products?q=  — serialized products with in-stock
// serials, for the Serial-label product picker. One row per product/variant grain
// that actually has in-stock serials, with the count.
export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'labels:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const q = (request.nextUrl.searchParams.get('q') || '').trim()
    const params: any[] = []
    let searchClause = 'TRUE'
    let rank = 'p.name'
    if (q) {
      const sc = buildProductSearchClause(q, 'p.name', 'p.sku', 'p.search_vector', 1)
      params.push(...sc.params)
      const varIdx = sc.nextIdx
      params.push(`%${q}%`)
      searchClause = `(${sc.clause} OR pv.variant_name ILIKE $${varIdx})`
      const rk = buildProductSearchRank(q, 'p.name', 'p.search_vector', varIdx + 1)
      params.push(...rk.params)
      rank = rk.rank
    }

    const products = await queryMany<any>(
      `SELECT ps.product_id, ps.variant_id,
              p.name AS product_name, p.sku, pv.variant_name,
              COUNT(*)::int AS in_stock_count
       FROM product_serials ps
       JOIN products p ON p.id = ps.product_id
       LEFT JOIN product_variants pv ON pv.id = ps.variant_id
       WHERE ps.status = 'in_stock' AND p.serialized = true AND ${searchClause}
       GROUP BY ps.product_id, ps.variant_id, p.name, p.sku, pv.variant_name, p.search_vector
       ORDER BY ${q ? `MIN(${rank}) ASC,` : ''} p.name ASC, pv.variant_name ASC NULLS FIRST
       LIMIT 100`,
      params
    )
    return NextResponse.json({ products })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
