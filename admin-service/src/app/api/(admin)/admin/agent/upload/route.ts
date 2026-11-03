import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { formFile } from '@/lib/shared/form-file'
import { MAX_ATTACHMENT_BYTES, resolveMime, unsupportedMessage } from '@/lib/admin-agent/file-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formFile(form, 'file', 'admin/agent/upload')
  if (!file) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB)` }, { status: 413 })
  }

  const mime = resolveMime(file.name, file.type)
  if (!mime) return NextResponse.json({ error: unsupportedMessage((file.type || '').toLowerCase()) }, { status: 415 })

  const buf = Buffer.from(await file.arrayBuffer())

  const inserted = await queryOne<{ id: string; created_at: string; expires_at: string }>(
    `INSERT INTO admin_agent_attachments (admin_id, filename, mime_type, byte_size, data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text, created_at::text, expires_at::text`,
    [admin.adminId, file.name || null, mime, buf.length, buf]
  )
  if (!inserted) {
    return NextResponse.json({ error: 'Failed to persist upload' }, { status: 500 })
  }

  return NextResponse.json({
    attachment_id: inserted.id,
    filename: file.name || null,
    mime_type: mime,
    byte_size: buf.length,
    expires_at: inserted.expires_at,
  })
}
