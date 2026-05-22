import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const variantId = request.nextUrl.searchParams.get('variantId')

  const [variantImage, productImage, product, variant] = await Promise.all([
    variantId
      ? queryOne(
          `SELECT COALESCE(thumbnail_url, image_url) AS image_url
           FROM variant_images WHERE variant_id = $1
           ORDER BY is_primary DESC, display_order ASC LIMIT 1`,
          [variantId]
        )
      : Promise.resolve(null),
    queryOne(
      `SELECT COALESCE(thumbnail_url, image_url) AS image_url
       FROM product_images WHERE product_id = $1
       ORDER BY is_primary DESC, display_order ASC LIMIT 1`,
      [params.id]
    ),
    queryOne(`SELECT name FROM products WHERE id = $1`, [params.id]),
    variantId
      ? queryOne(`SELECT variant_name FROM product_variants WHERE id = $1`, [variantId])
      : Promise.resolve(null),
  ])

  return NextResponse.json({
    imageUrl: variantImage?.image_url ?? productImage?.image_url ?? null,
    productName: product?.name ?? null,
    variantName: variant?.variant_name ?? null,
  })
}
