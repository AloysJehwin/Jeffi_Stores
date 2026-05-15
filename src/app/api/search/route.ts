import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { buildProductSearchClause, buildProductSearchRank, buildSearchClause } from '@/lib/search'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() || ''

    if (q.length < 2) {
      return NextResponse.json({ products: [], categories: [] })
    }

    const sc = buildProductSearchClause(q, 'p.name', 'p.sku', 'p.search_vector', 1)
    const rk = buildProductSearchRank(q, 'p.name', 'p.search_vector', sc.nextIdx)
    const catSc = buildSearchClause(q, ['name'], 1)

    const [products, categories] = await Promise.all([
      queryMany(`
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
        ORDER BY ${rk.rank}, p.name ASC
        LIMIT 6
      `, [...sc.params, ...rk.params]),
      queryMany(`
        SELECT id, name, slug FROM categories
        WHERE ${catSc.clause}
        ORDER BY name ASC
        LIMIT 3
      `, catSc.params),
    ])

    return NextResponse.json({ products: products || [], categories: categories || [] })
  } catch {
    return NextResponse.json({ products: [], categories: [] }, { status: 500 })
  }
}
