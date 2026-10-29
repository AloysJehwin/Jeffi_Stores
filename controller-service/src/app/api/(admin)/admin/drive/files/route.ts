import { NextRequest, NextResponse } from 'next/server'
import { hasScope } from '@/lib/auth/scopes'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { atLeast, folderLevel } from '@/lib/drive/access'
import { storeFile, logDriveAccess, toDriveFile, DriveError } from '@/lib/drive/files'
import { homeFolder } from '@/lib/drive/folders'
import { insertGalleryImage } from '@/lib/drive/gallery'
import { driveActor, driveFailure, reqMeta } from '@/lib/drive/http'
import { GALLERY_MAX_BYTES } from '@/lib/shared/s3'
import { GALLERY_FOLDER_ID } from '@/lib/drive/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Upload into a folder (default: the uploader's My files). Into the Gallery it goes through the
// public gallery pipeline instead.
export async function POST(request: NextRequest) {
  const actor = await driveActor(request, 'drive:write')
  if (actor instanceof NextResponse) return actor
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
    const target = String(form.get('folderId') || '') || null

    if (target === GALLERY_FOLDER_ID) {
      const admin = await authenticateAdmin(request)
      const canGallery = !!admin && ['products:write', 'settings:write', 'coupons:write', 'social:write'].some(s => hasScope(admin.role, admin.scopes, s))
      if (!canGallery) return NextResponse.json({ error: 'You cannot add to the gallery' }, { status: 403 })
      if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Only images can be uploaded to the gallery here' }, { status: 415 })
      if (file.size > GALLERY_MAX_BYTES) return NextResponse.json({ error: 'Images can be up to 20 MB' }, { status: 413 })
      const row = await insertGalleryImage(Buffer.from(await file.arrayBuffer()), file.name, file.type, { customName: file.name.replace(/\.[^.]+$/, '') })
      return NextResponse.json({ gallery: { id: row.id, url: row.image_url } })
    }

    const folderId = target ?? (await homeFolder(actor.adminId))
    if (!atLeast(await folderLevel(actor, folderId), 'edit')) return NextResponse.json({ error: 'You cannot upload here' }, { status: 403 })
    const f = await storeFile({ bytes: Buffer.from(await file.arrayBuffer()), name: file.name, mime: file.type, folderId, source: 'upload', adminId: actor.adminId })
    logDriveAccess({ fileId: f.id, adminId: actor.adminId, action: 'upload', ...reqMeta(request) }).catch(() => {})
    return NextResponse.json({ file: { ...toDriveFile(f), access: 'manage' } })
  } catch (err) {
    if (err instanceof DriveError) return NextResponse.json({ error: err.message }, { status: err.status })
    return driveFailure(err, 'Upload')
  }
}
