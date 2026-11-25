import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), driveFailure: vi.fn() }))
vi.mock('@/lib/drive/folders', () => ({ folderPath: vi.fn(), getFolder: vi.fn(), listFolders: vi.fn() }))
vi.mock('@/lib/drive/listing', () => ({ listFolderFiles: vi.fn(), searchFiles: vi.fn() }))
vi.mock('@/lib/drive/gallery', () => ({ listGalleryAsFiles: vi.fn() }))
vi.mock('@/lib/drive/documents', () => ({
  DOC_FOLDERS: { invoices: { name: 'Invoices', scope: 'orders:read' } },
  isDocFolder: (f: string) => f === 'invoices',
  listDocuments: vi.fn(),
}))
vi.mock('@/lib/drive/files', () => ({ toDriveFile: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/drive/route'
import { queryMany, queryOne } from '@/lib/shared/db'
import { hasScope } from '@/lib/auth/scopes'
import { driveActor, driveFailure } from '@/lib/drive/http'
import { folderPath, getFolder, listFolders } from '@/lib/drive/folders'
import { listFolderFiles, searchFiles } from '@/lib/drive/listing'
import { listGalleryAsFiles } from '@/lib/drive/gallery'
import { listDocuments } from '@/lib/drive/documents'
import { toDriveFile } from '@/lib/drive/files'
import { GALLERY_FOLDER_ID } from '@/lib/drive/types'

const ACTOR = { adminId: 'a1', role: 'admin', scopes: [] }
const req = (qs = '') => new NextRequest(`http://localhost/api/admin/drive${qs}`)
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue(ACTOR as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(driveFailure).mockReturnValue(NextResponse.json({ error: 'Listing failed' }, { status: 500 }))
  vi.mocked(toDriveFile).mockImplementation((r: any) => ({ id: r.id }) as any)
})

describe('GET /api/admin/drive', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:read')
  })

  it('lists the trash', async () => {
    vi.mocked(searchFiles).mockResolvedValue({ files: [{ id: 'x' }], total: 1 } as any)
    const body = await (await GET(req('?trash=1'))).json()
    expect(body).toEqual({ folders: [], files: [{ id: 'x' }], total: 1, path: [] })
    expect(searchFiles).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ trash: true }))
  })

  it('lists a document section when the scope allows, 403 otherwise', async () => {
    vi.mocked(listDocuments).mockResolvedValue({ files: [{ id: 'd1' }], total: 1 } as any)
    const body = await (await GET(req('?folder=invoices'))).json()
    expect(body.files).toEqual([{ id: 'd1' }])
    expect(body.path).toEqual([{ id: 'invoices', name: 'Invoices' }])
    expect(hasScope).toHaveBeenCalledWith('admin', [], 'orders:read')
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req('?folder=invoices'))).status).toBe(403)
  })

  it('returns no documents for a non-pdf kind filter', async () => {
    const body = await (await GET(req('?folder=invoices&kind=image'))).json()
    expect(body.total).toBe(0)
    expect(listDocuments).not.toHaveBeenCalled()
  })

  it('lists the gallery as a virtual folder', async () => {
    vi.mocked(listGalleryAsFiles).mockResolvedValue({ files: [{ id: 'g' }], total: 4 } as any)
    const body = await (await GET(req(`?folder=${GALLERY_FOLDER_ID}&kind=image`))).json()
    expect(body.files).toEqual([{ id: 'g' }])
    expect(body.total).toBe(4)
    expect(body.folder.systemKey).toBe('gallery')
    expect(listGalleryAsFiles).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image' }))
  })

  it('searches everything visible from the root', async () => {
    vi.mocked(searchFiles).mockResolvedValue({ files: [], total: 0 } as any)
    await GET(req('?q=%20logo%20&kind=pdf&page=2'))
    expect(searchFiles).toHaveBeenCalledWith(ACTOR, { search: 'logo', kind: 'pdf', limit: 60, offset: 120 })
  })

  it('shows the root: gallery folder, own folders and loose files', async () => {
    vi.mocked(listFolders).mockResolvedValue([{ id: 'f1' }] as any)
    vi.mocked(queryMany).mockResolvedValue([{ id: 'r1' }] as any)
    vi.mocked(queryOne).mockResolvedValue({ n: '7' } as any)
    const body = await (await GET(req())).json()
    expect(body.folders.map((f: any) => f.id)).toEqual([GALLERY_FOLDER_ID, 'f1'])
    expect(body.folders[0].fileCount).toBe(7)
    expect(body.files).toEqual([{ id: 'r1', access: 'manage' }])
    expect(queryMany).toHaveBeenCalledWith(expect.stringContaining('folder_id IS NULL'), ['a1'])
  })

  it('returns 404 for an unknown folder', async () => {
    vi.mocked(getFolder).mockResolvedValue(null as any)
    expect((await GET(req('?folder=zzz'))).status).toBe(404)
  })

  it('lists a real folder with its subfolders, files and path', async () => {
    vi.mocked(getFolder).mockResolvedValue({ id: 'f1' } as any)
    vi.mocked(listFolders).mockResolvedValue([{ id: 'sub' }] as any)
    vi.mocked(listFolderFiles).mockResolvedValue({ files: [{ id: 'x' }], total: 1 } as any)
    vi.mocked(folderPath).mockResolvedValue([{ id: 'f1', name: 'F' }] as any)
    const body = await (await GET(req('?folder=f1'))).json()
    expect(body).toEqual({ folder: { id: 'f1' }, folders: [{ id: 'sub' }], files: [{ id: 'x' }], total: 1, path: [{ id: 'f1', name: 'F' }] })
  })

  it('maps a storage failure through driveFailure', async () => {
    vi.mocked(getFolder).mockRejectedValue(new Error('db'))
    expect((await GET(req('?folder=f1'))).status).toBe(500)
    expect(driveFailure).toHaveBeenCalledWith(expect.any(Error), 'Listing')
  })
})
