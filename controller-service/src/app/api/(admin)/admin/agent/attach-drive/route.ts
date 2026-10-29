import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hasScope } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { queryOne } from '@/lib/shared/db'
import { fileFor } from '@/lib/drive/listing'
import { logDriveAccess, readFileBytes } from '@/lib/drive/files'
import { denied, driveActor, reqMeta } from '@/lib/drive/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// A Drive file handed to the assistant: copied into its attachments, with the same limits as an upload.
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

const schema = z.object({ fileId: z.string().uuid() })

export async function POST(req: NextRequest) {
  const actor = await driveActor(req, 'drive:read')
  if (actor instanceof NextResponse) return actor
  if (!hasScope(actor.role, actor.scopes, 'agent:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const parsed = parseBody(schema, await req.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response

  const f = await fileFor(actor, parsed.data.fileId)
  if (!f) return denied()
  const mime = f.row.mime_type.toLowerCase()
  if (!ALLOWED_MIMES.has(mime)) return NextResponse.json({ error: 'The assistant reads JPG, PNG, WEBP or PDF files' }, { status: 415 })
  if (Number(f.row.size_bytes) > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 413 })

  const buf = await readFileBytes(f.row)
  const inserted = await queryOne<{ id: string; expires_at: string }>(
    `INSERT INTO admin_agent_attachments (admin_id, filename, mime_type, byte_size, data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text, expires_at::text`,
    [actor.adminId, f.row.name, mime, buf.length, buf]
  )
  if (!inserted) return NextResponse.json({ error: 'Failed to attach the file' }, { status: 500 })
  logDriveAccess({ fileId: f.row.id, adminId: actor.adminId, action: 'view', ...reqMeta(req) }).catch(() => {})

  return NextResponse.json({ attachment_id: inserted.id, filename: f.row.name, mime_type: mime, byte_size: buf.length, expires_at: inserted.expires_at })
}
