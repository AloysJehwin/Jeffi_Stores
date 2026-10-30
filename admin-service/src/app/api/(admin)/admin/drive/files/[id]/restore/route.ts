import { NextRequest, NextResponse } from 'next/server'
import { atLeast } from '@/lib/drive/access'
import { fileFor, restoreFile } from '@/lib/drive/listing'
import { logDriveAccess } from '@/lib/drive/files'
import { driveActor, denied, reqMeta } from '@/lib/drive/http'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  const f = await fileFor(actor, id, { withDeleted: true })
  if (!f || !f.row.deleted_at) return denied()
  if (!atLeast(f.level, 'edit') && f.row.uploaded_by_admin_id !== actor.adminId) return NextResponse.json({ error: 'You cannot restore this file' }, { status: 403 })
  await restoreFile(id)
  logDriveAccess({ fileId: id, adminId: actor.adminId, action: 'restore', ...reqMeta(request) }).catch(() => {})
  return NextResponse.json({ success: true })
}
