import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / (1024 * 1024)}MB)` }, { status: 413 })
  }

  const mime = (file.type || '').toLowerCase()
  if (!ALLOWED_MIMES.has(mime)) {
    return NextResponse.json({ error: `Unsupported file type: ${mime || 'unknown'}` }, { status: 415 })
  }

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
