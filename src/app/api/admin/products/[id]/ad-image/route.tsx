import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { renderProductCard, persistCardToBucket } from '@/lib/social/card'
import { currentBrandNameAsync, storeBaseUrlAsync } from '@/lib/catalog/brand'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function buildCard(id: string) {
  const product = await queryOne<any>(
    `
    SELECT
      p.id, p.name, p.slug, p.base_price, p.price_ex_gst,
      (SELECT pi.image_url FROM product_images pi
       WHERE pi.product_id = p.id
       ORDER BY pi.is_primary DESC, pi.display_order ASC
       LIMIT 1) AS primary_image
    FROM products p
    WHERE p.id = $1
  `,
    [id]
  )

  if (!product) return null

  const salePrice = product.price_ex_gst ? Number(product.price_ex_gst) : null
  const basePrice = product.base_price ? Number(product.base_price) : null

  const displayPrice = salePrice ?? basePrice ?? 0
  const originalPrice = salePrice && basePrice && basePrice > salePrice ? basePrice : null

  const brand = await currentBrandNameAsync()
  const brandUrl = (await storeBaseUrlAsync()).replace(/^https?:\/\//, '')

  const png = await renderProductCard({
    product: {
      name: product.name,
      slug: product.slug,
      displayPrice,
      originalPrice,
      primaryImage: product.primary_image ?? null,
    },
    brand: { name: brand, url: brandUrl },
  })

  return { png, slug: product.slug as string }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const built = await buildCard(id)
  if (!built) return new Response('Product not found', { status: 404 })

  return new Response(new Uint8Array(built.png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="jeffi-ad-${built.slug}.png"`,
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Same card, but stored in S3 and returned as a URL. Meta fetches post images over the public
 * internet, so a social post cannot use the GET response above — it needs a hosted file.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const bucket = process.env.S3_BUCKET_NAME
  if (!bucket) return NextResponse.json({ error: 'S3_BUCKET_NAME is not configured' }, { status: 500 })

  const { id } = await params
  const built = await buildCard(id)
  if (!built) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // Timestamped key: regenerating after a price change must not be served from a CDN copy of
  // the old card.
  const key = `social-cards/${built.slug}-${Date.now()}.png`
  const url = await persistCardToBucket(built.png, { bucket, key })

  return NextResponse.json({ url })
}
