import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { uploadTemplateAsset } from '@jeffi/tenancy'
import { readUpload } from '@/lib/shared/form-file'
import { fetchImageBytes } from '@/lib/meta-ads/creative'
import { toPng } from '@/lib/shared/image-compat'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// One image upload for every "image URL" field in the admin (homepage, emails, brands, categories,
// social posts, WhatsApp headers). Returns a public CDN URL to put in the field.
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'])
const EDIT_SCOPES = [
  'settings:write',
  'templates:write',
  'mailer:write',
  'campaigns:write',
  'brands:write',
  'categories:write',
  'products:write',
  'social:write',
  'meta_ads_campaigns:write',
] as const

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!EDIT_SCOPES.some(s => hasScope(admin.role, admin.scopes, s))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // JSON { imageUrl }: a gallery image (our own media only) copied as PNG for a field whose clients
  // can't show WebP (email, WhatsApp, push, social).
  if ((req.headers.get('content-type') || '').includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    if (typeof body.imageUrl !== 'string') return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 })
    let png: Buffer
    try {
      png = await toPng(await fetchImageBytes(body.imageUrl))
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message || 'Could not read the image' }, { status: 400 })
    }
    if (png.length > MAX_BYTES) return NextResponse.json({ error: 'Image too large (max 5 MB)' }, { status: 413 })
    const r = await uploadTemplateAsset(png, null, 'image/png')
    return NextResponse.json({ url: r.url, key: r.key })
  }

  const up = await readUpload(req, 'admin/uploads/image')
  if ('error' in up) return NextResponse.json({ error: up.error }, { status: 400 })
  if (!ALLOWED.has(up.mime)) return NextResponse.json({ error: 'Use a PNG, JPEG, GIF, WebP or SVG image' }, { status: 400 })
  if (up.bytes.length > MAX_BYTES) return NextResponse.json({ error: 'Image too large (max 5 MB)' }, { status: 413 })

  const r = await uploadTemplateAsset(up.bytes, null, up.mime)
  return NextResponse.json({ url: r.url, key: r.key })
}
