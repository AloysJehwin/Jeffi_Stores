import { ImageResponse } from 'next/og'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { mrpDiscountPct } from '@/lib/pricing'
import { readFileSync } from 'fs'
import { join } from 'path'

const W = 1080
const H = 1920

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

function loadFont(name: string): Buffer {
  const candidates = [join(process.cwd(), 'public/fonts', name), join(process.cwd(), '../public/fonts', name)]
  for (const p of candidates) {
    try {
      return readFileSync(p)
    } catch {}
  }
  throw new Error(`Font not found: ${name}`)
}

let _fontBold: Buffer | null = null
let _fontRegular: Buffer | null = null
function getFonts() {
  if (!_fontBold) _fontBold = loadFont('NotoSans-Bold.ttf')
  if (!_fontRegular) _fontRegular = loadFont('NotoSans-Regular.ttf')
  return { fontBold: _fontBold, fontRegular: _fontRegular }
}

export interface CardProduct {
  name: string
  slug: string
  displayPrice: number
  originalPrice: number | null
  primaryImage: string | null
}

export interface CardBrand {
  name: string
  url: string
  accentColor?: string
}

export async function renderProductCard(opts: { product: CardProduct; brand: CardBrand }): Promise<Buffer> {
  const { product, brand } = opts
  const accent = brand.accentColor || '#7cb900'

  const discountPct = mrpDiscountPct(product.originalPrice, product.displayPrice)

  const maxSlugLen = 32
  const shortSlug = product.slug.length > maxSlugLen ? product.slug.slice(0, maxSlugLen) + '…' : product.slug
  const shortName = product.name.length > 50 ? product.name.slice(0, 48) + '…' : product.name
  const nameFontSize = shortName.length > 40 ? 64 : shortName.length > 25 ? 76 : 92

  let fonts: { name: string; data: Buffer; style: 'normal'; weight: 400 | 800 }[] = []
  try {
    const { fontBold, fontRegular } = getFonts()
    fonts = [
      { name: 'NotoSans', data: fontBold, style: 'normal', weight: 800 },
      { name: 'NotoSans', data: fontRegular, style: 'normal', weight: 400 },
    ]
  } catch {}

  const fontFamily = fonts.length > 0 ? '"NotoSans"' : 'sans-serif'

  /* eslint-disable @next/next/no-img-element */
  const response = new ImageResponse(
    <div
      style={{
        width: W,
        height: H,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0f1117',
        fontFamily,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ── Product image: top 70% ── */}
      <div style={{ width: W, height: H * 0.7, position: 'relative', display: 'flex', overflow: 'hidden' }}>
        {product.primaryImage ? (
          <img src={product.primaryImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: '#1a1d26',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#4a5568',
              fontSize: 36,
              letterSpacing: 2,
            }}
          >
            NO IMAGE
          </div>
        )}
        {/* Fade bottom of image into dark panel */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 280,
            background: 'linear-gradient(to bottom, transparent, #0f1117)',
            display: 'flex',
          }}
        />
        {/* Discount badge */}
        {discountPct && (
          <div
            style={{
              position: 'absolute',
              top: 56,
              right: 56,
              backgroundColor: '#f59e0b',
              color: '#000',
              borderRadius: 24,
              padding: '20px 48px',
              fontSize: 72,
              fontWeight: 900,
              display: 'flex',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              fontFamily,
            }}
          >
            {discountPct}% OFF
          </div>
        )}
      </div>

      {/* ── Info panel: bottom 30% ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '44px 80px 60px',
          background: 'linear-gradient(150deg, #0f1117 0%, #141f08 100%)',
        }}
      >
        {/* Product name */}
        <div
          style={{
            fontSize: nameFontSize,
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.15,
            fontFamily,
            display: 'flex',
            flexWrap: 'wrap',
          }}
        >
          {shortName}
        </div>

        {/* Bottom: URL + branding */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ height: 3, backgroundColor: accent, opacity: 0.4, borderRadius: 2, display: 'flex' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 40 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 34,
                  color: accent,
                  textTransform: 'uppercase',
                  letterSpacing: 4,
                  fontFamily,
                  display: 'flex',
                }}
              >
                Shop Now
              </div>
              <div
                style={{
                  fontSize: 28,
                  color: '#888',
                  fontFamily,
                  display: 'flex',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }}
              >
                {brand.url}/products/{shortSlug}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
              <div style={{ fontSize: 56, fontWeight: 900, color: '#f59e0b', fontFamily, display: 'flex' }}>
                {brand.name}
              </div>
              <div style={{ fontSize: 30, color: '#555', fontFamily, display: 'flex' }}>{brand.url}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Green accent strip */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 16,
          backgroundColor: accent,
          display: 'flex',
        }}
      />
    </div>,
    {
      width: W,
      height: H,
      ...(fonts.length > 0 ? { fonts } : {}),
    }
  )

  return Buffer.from(await response.arrayBuffer())
}

export async function persistCardToBucket(bytes: Buffer, opts: { bucket: string; key: string }): Promise<string> {
  const { bucket, key } = opts
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: 'image/png',
    })
  )
  return `https://${bucket}.s3.${AWS_REGION}.amazonaws.com/${key}`
}
