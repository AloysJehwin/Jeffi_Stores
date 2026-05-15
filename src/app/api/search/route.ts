import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { buildProductSearchClause, buildProductSearchRank } from '@/lib/search'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim() || ''

    if (query.length < 2) {
      return NextResponse.json({ products: [] })
    }

    const sc = buildProductSearchClause(query, 'p.name', 'p.sku', 'p.search_vector', 1)
    const { rank, params: rankParams, nextIdx } = buildProductSearchRank(query, 'p.name', 'p.search_vector', sc.nextIdx)
    const allParams = [...sc.params, ...rankParams]

    const products = await queryMany(`
      SELECT
        p.id, p.name, p.slug, p.base_price, p.sale_price, p.has_variants,
        json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
        (SELECT MIN(COALESCE(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true AND (pv.price IS NOT NULL OR pv.sale_price IS NOT NULL)) AS variant_min_price,
        COALESCE(
          (SELECT json_agg(json_build_object('image_url', pi.image_url, 'thumbnail_url', pi.thumbnail_url, 'is_primary', pi.is_primary))
           FROM product_images pi WHERE pi.product_id = p.id),
          '[]'::json
        ) AS product_images
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = true AND ${sc.clause}
      ORDER BY ${rank}, p.name ASC
      LIMIT 8
    `, allParams)

    return NextResponse.json({ products: products || [] })
  } catch {
    return NextResponse.json({ products: [] }, { status: 500 })
  }
}
