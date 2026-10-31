import { NextRequest, NextResponse } from 'next/server'
import { storeFile, logDriveAccess, DriveError } from '@/lib/drive/files'
import { supportFolder } from '@/lib/drive/folders'
import { customerChat } from '@/lib/support/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 25 * 1024 * 1024

// A file the customer is about to send: stored privately in the chat's Drive folder, then referenced
// by id when the message is posted.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await customerChat(request, sessionId)
  if (ctx instanceof NextResponse) return ctx
  if (ctx.session.status !== 'open') return NextResponse.json({ error: 'This chat is closed' }, { status: 409 })
  const len = Number(request.headers.get('content-length') || 0)
  if (len > MAX_BYTES + 64 * 1024) return NextResponse.json({ error: 'Files can be up to 25 MB' }, { status: 413 })
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
    const folderId = await supportFolder(ctx.session.ticket_number, sessionId)
    const f = await storeFile({
      bytes: Buffer.from(await file.arrayBuffer()),
      name: file.name,
      mime: file.type,
      folderId,
      source: 'support',
      userId: ctx.user.userId,
      maxBytes: MAX_BYTES,
    })
    logDriveAccess({ fileId: f.id, userId: ctx.user.userId, action: 'upload', ip: request.headers.get('x-forwarded-for'), userAgent: request.headers.get('user-agent') }).catch(() => {})
    return NextResponse.json({
      attachment: { id: f.id, kind: f.kind, mime: f.mime_type, name: f.name, size: Number(f.size_bytes), width: f.width, height: f.height },
    })
  } catch (err) {
    if (err instanceof DriveError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[support] attachment upload', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
