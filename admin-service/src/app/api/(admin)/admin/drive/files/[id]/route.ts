import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'
import { atLeast, folderLevel } from '@/lib/drive/access'
import { fileFor, moveFile, renameFile, trashFile } from '@/lib/drive/listing'
import { logDriveAccess, toDriveFile } from '@/lib/drive/files'
import { driveActor, denied, reqMeta } from '@/lib/drive/http'

export const dynamic = 'force-dynamic'

const schema = z.object({ name: z.string().trim().min(1).max(200).optional(), folderId: z.string().uuid().nullable().optional() })

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await driveActor(request, 'drive:read')
  if (actor instanceof NextResponse) return actor
  const f = await fileFor(actor, id)
  if (!f) return denied()
  return NextResponse.json({ file: { ...toDriveFile(f.row), access: f.level } })
}

// Rename (edit level) or move (edit on the file and on the destination).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  const parsed = parseBody(schema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const f = await fileFor(actor, id)
  if (!f) return denied()
  if (!atLeast(f.level, 'edit')) return NextResponse.json({ error: 'You can only view this file' }, { status: 403 })
  if (parsed.data.name) {
    await renameFile(id, parsed.data.name)
    logDriveAccess({ fileId: id, adminId: actor.adminId, action: 'rename', ...reqMeta(request) }).catch(() => {})
  }
  if (parsed.data.folderId !== undefined) {
    if (parsed.data.folderId && !atLeast(await folderLevel(actor, parsed.data.folderId), 'edit')) return NextResponse.json({ error: 'You cannot move it there' }, { status: 403 })
    await moveFile(id, parsed.data.folderId)
    logDriveAccess({ fileId: id, adminId: actor.adminId, action: 'move', ...reqMeta(request) }).catch(() => {})
  }
  const next = await fileFor(actor, id)
  return NextResponse.json({ file: next ? { ...toDriveFile(next.row), access: next.level } : null })
}

// To the trash (restorable for 30 days).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  const f = await fileFor(actor, id)
  if (!f) return denied()
  if (!atLeast(f.level, 'edit')) return NextResponse.json({ error: 'You can only view this file' }, { status: 403 })
  await trashFile(id)
  logDriveAccess({ fileId: id, adminId: actor.adminId, action: 'delete', ...reqMeta(request) }).catch(() => {})
  return NextResponse.json({ success: true })
}
