import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { uploadTemplateAsset } from '@jeffi/tenancy'
import { readUpload } from '@/lib/shared/form-file'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = new Set(['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/svg+xml'])

export async function POST(req: NextRequest) {
  const auth = await requireAdminScope(req, 'templates:write')
  if (auth instanceof NextResponse) return auth
  const tenant = await resolveTenant()
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 })

  const up = await readUpload(req, 'admin/messaging-templates/assets')
  if ('error' in up) return NextResponse.json({ error: up.error }, { status: 400 })
  const mime = up.mime
  if (!ALLOWED.has(mime)) return NextResponse.json({ error: `unsupported type: ${mime}` }, { status: 400 })
  if (up.bytes.length > MAX_BYTES) return NextResponse.json({ error: 'file too large (max 5MB)' }, { status: 413 })

  const result = await uploadTemplateAsset(up.bytes, up.field('templateId') || null, mime)
  return NextResponse.json({ url: result.url, key: result.key, bytes: up.bytes.length, mime })
}
