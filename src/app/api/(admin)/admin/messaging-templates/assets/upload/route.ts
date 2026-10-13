import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { uploadTemplateAsset } from '@jeffi/tenancy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = new Set(['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/svg+xml'])

export async function POST(req: NextRequest) {
  const auth = await requireAdminScope(req, 'templates:write')
  if (auth instanceof NextResponse) return auth
  const tenant = await resolveTenant()
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const templateId = (form?.get('templateId') as string) || null
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  const mime = file.type || 'application/octet-stream'
  if (!ALLOWED.has(mime)) return NextResponse.json({ error: `unsupported type: ${mime}` }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (max 5MB)' }, { status: 413 })

  const buf = Buffer.from(await file.arrayBuffer())
  const result = await uploadTemplateAsset(buf, templateId, mime)
  return NextResponse.json({ url: result.url, key: result.key, bytes: buf.length, mime })
}
