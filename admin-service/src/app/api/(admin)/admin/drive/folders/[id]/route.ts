import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'
import { atLeast, folderLevel } from '@/lib/drive/access'
import { getFolder, isWithin, trashFolder, updateFolder } from '@/lib/drive/folders'
import { driveActor, driveFailure, denied } from '@/lib/drive/http'
import { logDriveAccess } from '@/lib/drive/files'

export const dynamic = 'force-dynamic'

const schema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  visibility: z.enum(['private', 'team', 'shared']).optional(),
  parentId: z.string().uuid().nullable().optional(),
})

// Rename, change visibility or move a folder (manage level; system folders are fixed).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  const parsed = parseBody(schema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  try {
    const f = await getFolder(actor, id)
    if (!f) return denied()
    if (f.access !== 'manage') return NextResponse.json({ error: 'Only the owner can change this folder' }, { status: 403 })
    if (f.systemKey) return NextResponse.json({ error: 'System folders cannot be changed' }, { status: 400 })
    const { parentId } = parsed.data
    if (parentId !== undefined && parentId !== null) {
      if (await isWithin(parentId, id)) return NextResponse.json({ error: 'A folder cannot go inside itself' }, { status: 400 })
      if (!atLeast(await folderLevel(actor, parentId), 'edit')) return NextResponse.json({ error: 'You cannot move it there' }, { status: 403 })
    }
    await updateFolder(id, parsed.data)
    logDriveAccess({ folderId: id, adminId: actor.adminId, action: parentId !== undefined ? 'move' : 'rename' }).catch(() => {})
    return NextResponse.json({ folder: await getFolder(actor, id) })
  } catch (err) {
    return driveFailure(err, 'Updating the folder')
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  const f = await getFolder(actor, id)
  if (!f) return denied()
  if (f.access !== 'manage') return NextResponse.json({ error: 'Only the owner can delete this folder' }, { status: 403 })
  if (!(await trashFolder(id))) return NextResponse.json({ error: 'System folders cannot be deleted' }, { status: 400 })
  logDriveAccess({ folderId: id, adminId: actor.adminId, action: 'delete' }).catch(() => {})
  return NextResponse.json({ success: true })
}
