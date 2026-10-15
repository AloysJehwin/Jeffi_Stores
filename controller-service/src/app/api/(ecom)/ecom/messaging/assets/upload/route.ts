import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@/lib/ecom/owner-api'
import { hasService } from '@/lib/tenant-registry'
import { uploadTemplateAsset } from '@jeffi/tenancy'
import { readUpload } from '@/lib/shared/form-file'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = new Set(['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/svg+xml'])

export async function POST(req: NextRequest) {
  const ctx = await ownerApi(req)
  if (ctx instanceof NextResponse) return ctx
  if (!hasService(ctx.tenant, 'messaging')) return NextResponse.json({ error: 'messaging not enabled' }, { status: 403 })

  const up = await readUpload(req, 'ecom/messaging/assets')
  if ('error' in up) return NextResponse.json({ error: up.error }, { status: 400 })
  const mime = up.mime
  if (!ALLOWED.has(mime)) return NextResponse.json({ error: `unsupported type: ${mime}` }, { status: 400 })
  if (up.bytes.length > MAX_BYTES) return NextResponse.json({ error: 'file too large (max 5MB)' }, { status: 413 })

  const result = await uploadTemplateAsset(up.bytes, up.field('templateId') || null, mime)
  return NextResponse.json({ url: result.url, key: result.key, bytes: up.bytes.length, mime })
}
