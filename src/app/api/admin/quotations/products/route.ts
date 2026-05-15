import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'
import { buildProductSearchClause, buildProductSearchRank } from '@/lib/search'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim() || ''
    const categoryId = searchParams.get('category_id')?.trim() || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '40'), 100)

    let idx = 1
    const params: unknown[] = []

    const catClause = categoryId ? `p.category_id = $${idx++}::uuid` : 'TRUE'
    if (categoryId) params.push(categoryId)

    let searchWhere = 'TRUE'
    let searchWherePv = 'TRUE'
    let rank = '(0+0)'
    if (q) {
      const sc = buildProductSearchClause(q, 'p.name', 'p.sku', 'p.search_vector', idx)
      searchWhere = sc.clause
      params.push(...sc.params)
      idx = sc.nextIdx

      const sc2 = buildProductSearchClause(q, 'p.name', 'pv.sku', 'p.search_vector', idx)
      searchWherePv = sc2.clause
      params.push(...sc2.params)
      idx = sc2.nextIdx

      const rk = buildProductSearchRank(q, 'name', 'p.search_vector', idx)
      rank = rk.rank
      params.push(...rk.params)
      idx = rk.nextIdx
    }

    const limitIdx = idx++
    params.push(limit)

    const rows = await queryMany(
      `SELECT * FROM (
         SELECT
           'product:' || p.id AS id,
           p.id AS product_id,
           NULL::uuid AS variant_id,
           p.name,
           NULL AS variant_name,
           p.sku,
           COALESCE(p.mrp, 0)::numeric AS mrp,
           p.base_price,
           COALESCE(p.gst_percentage, 0)::numeric AS gst_percentage,
           p.hsn_code,
           p.is_active
         FROM products p
         WHERE p.has_variants = false AND ${catClause} AND ${searchWhere}

         UNION ALL

         SELECT
           'variant:' || pv.id AS id,
           p.id AS product_id,
           pv.id AS variant_id,
           p.name,
           pv.variant_name,
           pv.sku,
           COALESCE(pv.mrp, 0)::numeric AS mrp,
           COALESCE(pv.price, p.base_price) AS base_price,
           COALESCE(p.gst_percentage, 0)::numeric AS gst_percentage,
           p.hsn_code,
           p.is_active AND pv.is_active AS is_active
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE ${catClause} AND ${searchWherePv}
       ) results
       ORDER BY ${rank}, name ASC, variant_name ASC NULLS FIRST
       LIMIT $${limitIdx}`,
      params
    )

    return NextResponse.json({ products: rows || [] })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
