import { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { renderProductCard } from '@/lib/social/card'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await authenticateAdmin(request)
  if (!admin) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const product = await queryOne<any>(`
    SELECT
      p.id, p.name, p.slug, p.base_price, p.price_ex_gst,
      (SELECT pi.image_url FROM product_images pi
       WHERE pi.product_id = p.id
       ORDER BY pi.is_primary DESC, pi.display_order ASC
       LIMIT 1) AS primary_image
    FROM products p
    WHERE p.id = $1
  `, [id])

  if (!product) return new Response('Product not found', { status: 404 })

  const salePrice = product.price_ex_gst ? Number(product.price_ex_gst) : null
  const basePrice = product.base_price ? Number(product.base_price) : null

  const displayPrice  = salePrice ?? basePrice ?? 0
  const originalPrice = (salePrice && basePrice && basePrice > salePrice) ? basePrice : null

  const png = await renderProductCard({
    product: {
      name: product.name,
      slug: product.slug,
      displayPrice,
      originalPrice,
      primaryImage: product.primary_image ?? null,
    },
    brand: { name: 'Jeffi Stores', url: 'jeffistores.in' },
  })

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="jeffi-ad-${product.slug}.png"`,
      'Cache-Control': 'no-store',
    },
  })
}
