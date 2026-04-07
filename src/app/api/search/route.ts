import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'

// Mark as dynamic to prevent static generation errors
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ products: [] })
    }

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
      WHERE p.is_active = true AND p.name ILIKE $1
      ORDER BY p.name ASC
      LIMIT 5
    `, [`%${query}%`])

    return NextResponse.json({ products: products || [] })
  } catch (error) {
    console.error('Search API error:', error)
    return NextResponse.json({ products: [] }, { status: 500 })
  }
}
