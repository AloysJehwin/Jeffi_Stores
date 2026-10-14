import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@/lib/ecom/owner-api'
import { hasService } from '@/lib/tenant-registry'
import { uploadTemplateAsset } from '@jeffi/tenancy'
import { formFile, readForm } from '@/lib/shared/form-file'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = new Set(['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/svg+xml'])

export async function POST(req: NextRequest) {
  const ctx = await ownerApi(req)
  if (ctx instanceof NextResponse) return ctx
  if (!hasService(ctx.tenant, 'messaging')) return NextResponse.json({ error: 'messaging not enabled' }, { status: 403 })

  const form = await readForm(req, 'ecom/messaging/assets')
  const file = formFile(form, 'file', 'ecom/messaging/assets')
  const templateId = (form?.get('templateId') as string) || null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  const mime = file.type || 'application/octet-stream'
  if (!ALLOWED.has(mime)) return NextResponse.json({ error: `unsupported type: ${mime}` }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (max 5MB)' }, { status: 413 })

  const buf = Buffer.from(await file.arrayBuffer())
  const result = await uploadTemplateAsset(buf, templateId, mime)
  return NextResponse.json({ url: result.url, key: result.key, bytes: buf.length, mime })
}
