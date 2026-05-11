import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const W = 1080
const H = 1920

const fontBold    = readFileSync(join(process.cwd(), 'public/fonts/NotoSans-Bold.ttf'))
const fontRegular = readFileSync(join(process.cwd(), 'public/fonts/NotoSans-Regular.ttf'))

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await authenticateAdmin(request)
  if (!admin) return new Response('Unauthorized', { status: 401 })

  const product = await queryOne<any>(`
    SELECT
      p.id, p.name, p.slug, p.base_price, p.sale_price, p.compare_at_price,
      (SELECT pi.image_url FROM product_images pi
       WHERE pi.product_id = p.id
       ORDER BY pi.is_primary DESC, pi.display_order ASC
       LIMIT 1) AS primary_image
    FROM products p
    WHERE p.id = $1
  `, [params.id])

  if (!product) return new Response('Product not found', { status: 404 })

  const salePrice  = product.sale_price       ? Number(product.sale_price)       : null
  const basePrice  = product.base_price       ? Number(product.base_price)       : null
  const compareAt  = product.compare_at_price ? Number(product.compare_at_price) : null

  const displayPrice  = salePrice ?? basePrice ?? 0
  const originalPrice = compareAt ?? (salePrice && basePrice && basePrice > salePrice ? basePrice : null)
  const discountPct   = originalPrice && originalPrice > displayPrice
    ? Math.round(((originalPrice - displayPrice) / originalPrice) * 100)
    : null

  const productUrl = `jeffistores.in/products/${product.slug}`
  const shortName  = product.name.length > 50 ? product.name.slice(0, 48) + '…' : product.name
  const nameFontSize = shortName.length > 40 ? 64 : shortName.length > 25 ? 76 : 92

  /* eslint-disable @next/next/no-img-element */
  return new ImageResponse(
    (
      <div
        style={{
          width: W, height: H,
          display: 'flex', flexDirection: 'column',
          backgroundColor: '#0f1117',
          fontFamily: '"NotoSans"',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* ── Product image: top 70% ── */}
        <div style={{ width: W, height: H * 0.70, position: 'relative', display: 'flex', overflow: 'hidden' }}>
          {product.primary_image
            ? <img src={product.primary_image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', backgroundColor: '#1a1d26', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 140, display: 'flex' }}>📦</div>
              </div>
          }
          {/* Fade bottom of image into dark panel */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 280, background: 'linear-gradient(to bottom, transparent, #0f1117)', display: 'flex' }} />

          {/* Discount badge — top right */}
          {discountPct && (
            <div style={{
              position: 'absolute', top: 56, right: 56,
              backgroundColor: '#f59e0b', color: '#000',
              borderRadius: 24, padding: '20px 48px',
              fontSize: 72, fontWeight: 900,
              display: 'flex', boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              fontFamily: '"NotoSans"',
            }}>
              {discountPct}% OFF
            </div>
          )}
        </div>

        {/* ── Info panel: bottom 30% ── */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '44px 80px 60px',
          background: 'linear-gradient(150deg, #0f1117 0%, #141f08 100%)',
        }}>
          {/* Product name — big and bold */}
          <div style={{
            fontSize: nameFontSize,
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.15,
            fontFamily: '"NotoSans"',
            display: 'flex',
            flexWrap: 'wrap',
          }}>
            {shortName}
          </div>

          {/* Bottom: URL + branding */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Divider */}
            <div style={{ height: 3, backgroundColor: '#7cb900', opacity: 0.4, borderRadius: 2, display: 'flex' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              {/* Shop Now + URL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 36, color: '#7cb900', textTransform: 'uppercase', letterSpacing: 4, fontFamily: '"NotoSans"', display: 'flex' }}>
                  Shop Now
                </div>
                <div style={{ fontSize: 36, color: '#888', fontFamily: '"NotoSans"', display: 'flex' }}>
                  {productUrl}
                </div>
              </div>

              {/* Jeffi Stores branding */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <div style={{ fontSize: 60, fontWeight: 900, color: '#f59e0b', fontFamily: '"NotoSans"', display: 'flex' }}>
                  Jeffi Stores
                </div>
                <div style={{ fontSize: 32, color: '#555', fontFamily: '"NotoSans"', display: 'flex' }}>
                  jeffistores.in
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Green accent strip at very bottom */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 16, backgroundColor: '#7cb900', display: 'flex' }} />
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: 'NotoSans', data: fontBold,    style: 'normal', weight: 800 },
        { name: 'NotoSans', data: fontRegular, style: 'normal', weight: 400 },
      ],
      headers: {
        'Content-Disposition': `attachment; filename="jeffi-ad-${product.slug}.png"`,
        'Cache-Control': 'no-store',
      },
    }
  )
}
