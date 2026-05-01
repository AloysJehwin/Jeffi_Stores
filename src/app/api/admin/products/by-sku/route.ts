import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const sku = new URL(request.url).searchParams.get('q')?.trim()
    if (!sku) return NextResponse.json({ error: 'q required' }, { status: 400 })

    const product = await queryOne<any>(
      `SELECT
         p.id, p.id AS product_id, NULL::uuid AS variant_id,
         p.name, NULL AS variant_name,
         p.sku, p.slug,
         COALESCE(p.mrp, 0)::numeric AS mrp,
         p.sale_price,
         p.base_price,
         COALESCE(p.gst_percentage, 0)::numeric AS gst_percentage,
         b.name AS brand_name,
         c.name AS category_name,
         p.gtin,
         p.stock_quantity,
         p.is_active,
         p.has_variants,
         (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) AS image_url
       FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.sku = $1
       LIMIT 1`,
      [sku]
    )

    if (product) {
      return NextResponse.json({ type: 'product', item: product })
    }

    const variant = await queryOne<any>(
      `SELECT
         pv.id, p.id AS product_id, pv.id AS variant_id,
         p.name, pv.variant_name,
         pv.sku, p.slug,
         COALESCE(pv.mrp, 0)::numeric AS mrp,
         pv.sale_price,
         COALESCE(pv.price, p.base_price) AS base_price,
         COALESCE(p.gst_percentage, 0)::numeric AS gst_percentage,
         b.name AS brand_name,
         c.name AS category_name,
         COALESCE(pv.gtin, p.gtin) AS gtin,
         pv.stock_quantity,
         pv.is_active,
         false AS has_variants,
         (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) AS image_url
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE pv.sku = $1
       LIMIT 1`,
      [sku]
    )

    if (variant) {
      return NextResponse.json({ type: 'variant', item: variant })
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
