import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, authenticateAnyUser } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { getFileRow, logDriveAccess, signFile } from '@/lib/drive/files'

export const dynamic = 'force-dynamic'

// A chat attachment: the chat's customer or a staff member who can read customers gets a short-lived
// signed link (inline for media and PDFs, a download for everything else).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await queryOne<{ drive_file_id: string | null; user_id: string | null }>(
    `SELECT a.drive_file_id, s.user_id FROM support_message_attachments a
       JOIN support_messages m ON m.id = a.message_id
       JOIN support_sessions s ON s.id = m.session_id
      WHERE a.id = $1`,
    [id]
  ).catch(() => null)
  if (!a?.drive_file_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let adminId: string | null = null
  let userId: string | null = null
  const admin = await authenticateAdmin(request, { passive: true }).catch(() => null)
  if (admin && hasScope(admin.role, admin.scopes, 'customers:read')) adminId = admin.adminId
  else {
    const user = await authenticateAnyUser(request).catch(() => null)
    if (user && a.user_id && user.userId === a.user_id) userId = user.userId
  }
  if (!adminId && !userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const f = await getFileRow(a.drive_file_id, { withDeleted: true })
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sp = request.nextUrl.searchParams
  const thumb = sp.get('thumb') === '1'
  const download = sp.get('download') === '1'
  if (!thumb) {
    logDriveAccess({ fileId: f.id, adminId, userId, action: download ? 'download' : 'view', ip: request.headers.get('x-forwarded-for'), userAgent: request.headers.get('user-agent') }).catch(() => {})
  }
  const url = await signFile(f, { thumb, download })
  return NextResponse.redirect(new URL(url, request.url), { status: 302, headers: { 'Cache-Control': 'private, max-age=60' } })
}
