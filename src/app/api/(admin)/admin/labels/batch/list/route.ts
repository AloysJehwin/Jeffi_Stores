import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { buildProductSearchClause, buildProductSearchRank } from '@/lib/catalog/search'
import { queryMany } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// GET /api/admin/labels/batch/list?q=&product_id=  — batches for the label picker.
export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'labels:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const q = (request.nextUrl.searchParams.get('q') || '').trim()
    const productId = request.nextUrl.searchParams.get('product_id') || ''

    const conditions: string[] = ['pb.quantity_remaining > 0', 'p.perishable = true']
    const params: any[] = []
    if (productId) {
      params.push(productId)
      conditions.push(`pb.product_id = $${params.length}`)
    }

    let rank = ''
    if (q) {
      const sc = buildProductSearchClause(q, 'p.name', 'p.sku', 'p.search_vector', params.length + 1)
      params.push(...sc.params)
      const lotIdx = sc.nextIdx
      params.push(`%${q}%`)
      conditions.push(`(${sc.clause} OR pb.lot_number ILIKE $${lotIdx})`)
      const rk = buildProductSearchRank(q, 'p.name', 'p.search_vector', lotIdx + 1)
      params.push(...rk.params)
      rank = rk.rank
    }

    const orderBy = q
      ? `${rank} ASC, pb.expiry_date ASC NULLS LAST, pb.created_at DESC`
      : `pb.expiry_date ASC NULLS LAST, pb.created_at DESC`

    const batches = await queryMany<any>(
      `SELECT pb.id, pb.lot_number, pb.expiry_date, pb.manufacture_date, pb.quantity_remaining,
              p.name AS product_name, p.sku, pv.variant_name
       FROM product_batches pb
       JOIN products p ON p.id = pb.product_id
       LEFT JOIN product_variants pv ON pv.id = pb.variant_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 50`,
      params
    )
    return NextResponse.json({ batches })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
