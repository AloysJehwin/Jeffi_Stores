import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { buildSearchClause, buildSearchRank } from '@/lib/search'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim() || ''

    if (query.length < 2) {
      return NextResponse.json({ products: [] })
    }

    const sc = buildSearchClause(query, ['p.name', 'p.sku'], 1)
    const rank = buildSearchRank(query, 'p.name')

    const products = await queryMany(`
      SELECT
        p.id, p.name, p.slug, p.base_price, p.sale_price, p.has_variants,
        (SELECT MIN(COALESCE(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true AND (pv.price IS NOT NULL OR pv.sale_price IS NOT NULL)) AS variant_min_price,
        COALESCE(
          (SELECT json_agg(json_build_object('image_url', pi.image_url, 'thumbnail_url', pi.thumbnail_url, 'is_primary', pi.is_primary))
           FROM product_images pi WHERE pi.product_id = p.id),
          '[]'::json
        ) AS product_images
      FROM products p
      WHERE p.is_active = true AND ${sc.clause}
      ORDER BY ${rank}, p.name ASC
      LIMIT 8
    `, sc.params)

    return NextResponse.json({ products: products || [] })
  } catch {
    return NextResponse.json({ products: [] }, { status: 500 })
  }
}
