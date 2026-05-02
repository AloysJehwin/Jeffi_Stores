import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim() || ''
    const categoryId = searchParams.get('category_id')?.trim() || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '40'), 100)

    const rows = await queryMany(
      `SELECT
         'product:' || p.id AS id,
         p.id AS product_id,
         NULL::uuid AS variant_id,
         p.name,
         NULL AS variant_name,
         p.sku,
         p.slug,
         COALESCE(p.mrp, 0)::numeric AS mrp,
         p.sale_price,
         p.base_price,
         COALESCE(p.gst_percentage, 0)::numeric AS gst_percentage,
         p.hsn_code,
         b.name AS brand_name,
         p.gtin
       FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.is_active = true
         AND p.has_variants = false
         AND ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE '%' || $1 || '%')
         AND ($2 = '' OR p.category_id = $2::uuid)

       UNION ALL

       SELECT
         'variant:' || pv.id AS id,
         p.id AS product_id,
         pv.id AS variant_id,
         p.name,
         pv.variant_name,
         pv.sku,
         p.slug,
         COALESCE(pv.mrp, 0)::numeric AS mrp,
         pv.sale_price,
         COALESCE(pv.price, p.base_price) AS base_price,
         COALESCE(p.gst_percentage, 0)::numeric AS gst_percentage,
         p.hsn_code,
         b.name AS brand_name,
         COALESCE(pv.gtin, p.gtin) AS gtin
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE pv.is_active = true
         AND p.is_active = true
         AND ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR pv.variant_name ILIKE '%' || $1 || '%' OR pv.sku ILIKE '%' || $1 || '%')
         AND ($2 = '' OR p.category_id = $2::uuid)

       ORDER BY name ASC, variant_name ASC NULLS FIRST
       LIMIT $3`,
      [q, categoryId, limit]
    )

    return NextResponse.json({ products: rows || [] })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
