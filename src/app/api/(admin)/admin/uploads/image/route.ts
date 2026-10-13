import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { uploadTemplateAsset } from '@jeffi/tenancy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// One image upload for every "image URL" field in the admin (homepage, emails, brands, social posts,
// WhatsApp headers). Returns a public CDN URL to put in the field.
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'])
const EDIT_SCOPES = ['settings:write', 'templates:write', 'mailer:write', 'campaigns:write', 'brands:write', 'products:write'] as const

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!EDIT_SCOPES.some(s => hasScope(admin.role, admin.scopes, s))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  const mime = file.type || 'application/octet-stream'
  if (!ALLOWED.has(mime)) return NextResponse.json({ error: 'Use a PNG, JPEG, GIF, WebP or SVG image' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image too large (max 5 MB)' }, { status: 413 })

  const r = await uploadTemplateAsset(Buffer.from(await file.arrayBuffer()), null, mime)
  return NextResponse.json({ url: r.url, key: r.key })
}
