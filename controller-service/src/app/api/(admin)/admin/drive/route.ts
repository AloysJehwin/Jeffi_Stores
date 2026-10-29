import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/shared/db'
import { driveActor, driveFailure } from '@/lib/drive/http'
import { folderPath, getFolder, listFolders } from '@/lib/drive/folders'
import { listFolderFiles, searchFiles } from '@/lib/drive/listing'
import { listGalleryAsFiles } from '@/lib/drive/gallery'
import { toDriveFile, type DriveFileRow } from '@/lib/drive/files'
import { GALLERY_FOLDER_ID, type DriveFolder, type DriveKind } from '@/lib/drive/types'

export const dynamic = 'force-dynamic'

const KINDS: DriveKind[] = ['image', 'video', 'audio', 'pdf', 'doc', 'other']
const PAGE = 60

// One Drive view: ?folder=<id> (or root / gallery), ?q= searches everything visible, ?trash=1.
export async function GET(request: NextRequest) {
  const actor = await driveActor(request, 'drive:read')
  if (actor instanceof NextResponse) return actor
  try {
    const sp = request.nextUrl.searchParams
    const folder = sp.get('folder') || 'root'
    const q = sp.get('q')?.trim() || null
    const k = sp.get('kind') as DriveKind | null
    const kind = k && KINDS.includes(k) ? k : null
    const page = Math.max(0, Number(sp.get('page')) || 0)
    const opts = { search: q, kind, limit: PAGE, offset: page * PAGE }

    if (sp.get('trash') === '1') return NextResponse.json({ folders: [], ...(await searchFiles(actor, { ...opts, trash: true })), path: [] })
    if (folder === GALLERY_FOLDER_ID) {
      const g = await listGalleryAsFiles({ search: q ?? undefined, kind: kind === 'image' || kind === 'video' ? kind : null, limit: PAGE, offset: page * PAGE })
      return NextResponse.json({ folder: galleryFolder(), folders: [], files: g.files, total: g.total, path: [{ id: GALLERY_FOLDER_ID, name: 'Gallery' }] })
    }
    if (q && folder === 'root') return NextResponse.json({ folders: [], ...(await searchFiles(actor, opts)), path: [] })
    if (folder === 'root') {
      const [folders, loose] = await Promise.all([
        listFolders(actor, null),
        queryMany<DriveFileRow>(
          `SELECT * FROM drive_files WHERE folder_id IS NULL AND uploaded_by_admin_id = $1 AND deleted_at IS NULL ${kind ? 'AND kind = $2' : ''} ORDER BY created_at DESC LIMIT ${PAGE}`,
          kind ? [actor.adminId, kind] : [actor.adminId]
        ),
      ])
      const gallery = await queryOne<{ n: string }>(`SELECT (SELECT count(*) FROM gallery_images) + (SELECT count(*) FROM gallery_videos) AS n`).catch(() => null)
      return NextResponse.json({
        folder: null,
        folders: [{ ...galleryFolder(), fileCount: Number(gallery?.n ?? 0) }, ...folders],
        files: loose.map(r => ({ ...toDriveFile(r), access: 'manage' })),
        total: loose.length,
        path: [],
      })
    }
    const f = await getFolder(actor, folder)
    if (!f) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    const [folders, files, path] = await Promise.all([listFolders(actor, folder), listFolderFiles(actor, folder, opts), folderPath(folder)])
    return NextResponse.json({ folder: f, folders, files: files?.files ?? [], total: files?.total ?? 0, path })
  } catch (err) {
    return driveFailure(err, 'Listing')
  }
}

function galleryFolder(): DriveFolder {
  return { id: GALLERY_FOLDER_ID, parentId: null, name: 'Gallery', visibility: 'team', systemKey: 'gallery', ownerAdminId: null, ownerName: null, createdAt: new Date(0).toISOString(), access: 'view' }
}
