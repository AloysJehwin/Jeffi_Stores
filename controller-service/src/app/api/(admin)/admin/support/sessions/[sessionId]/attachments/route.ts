import { NextRequest, NextResponse } from 'next/server'
import { storeFile, logDriveAccess, DriveError } from '@/lib/drive/files'
import { supportFolder } from '@/lib/drive/folders'
import { adminChat } from '@/lib/support/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 64 * 1024 * 1024

// An agent's upload for a reply, kept in the chat's Drive folder.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await adminChat(request, sessionId, 'customers:write')
  if (ctx instanceof NextResponse) return ctx
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
    const f = await storeFile({
      bytes: Buffer.from(await file.arrayBuffer()),
      name: file.name,
      mime: file.type,
      folderId: await supportFolder(ctx.session.ticket_number, sessionId),
      source: 'support',
      adminId: ctx.admin.adminId,
      maxBytes: MAX_BYTES,
    })
    logDriveAccess({ fileId: f.id, adminId: ctx.admin.adminId, action: 'upload', ip: request.headers.get('x-forwarded-for'), userAgent: request.headers.get('user-agent') }).catch(() => {})
    return NextResponse.json({ attachment: { id: f.id, kind: f.kind, mime: f.mime_type, name: f.name, size: Number(f.size_bytes), width: f.width, height: f.height } })
  } catch (err) {
    if (err instanceof DriveError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[support] agent upload', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
