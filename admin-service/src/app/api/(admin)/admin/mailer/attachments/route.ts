import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { uploadTemplateAsset } from '@jeffi/tenancy'
import { readUpload } from '@/lib/shared/form-file'
import { MAX_ATTACHMENT_BYTES } from '@/lib/messaging/broadcast-shared'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// A file attached to a Messaging email. Stored under template-assets/mailer/, the only place the send
// downloads attachments from.
const ALLOWED = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
])

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const up = await readUpload(req, 'admin/mailer/attachments')
  if ('error' in up) return NextResponse.json({ error: up.error }, { status: 400 })
  if (!ALLOWED.has(up.mime)) return NextResponse.json({ error: 'Attach a PDF, image, Word, Excel, PowerPoint, CSV or text file' }, { status: 400 })
  if (up.bytes.length > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 })

  const r = await uploadTemplateAsset(up.bytes, 'mailer', up.mime)
  return NextResponse.json({ url: r.url, name: up.name || 'attachment', size: up.bytes.length, mime: up.mime })
}
