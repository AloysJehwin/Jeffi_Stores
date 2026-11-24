import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/drive/access', () => ({ atLeast: vi.fn(), folderLevel: vi.fn() }))
vi.mock('@/lib/drive/files', () => {
  class DriveError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return { storeFile: vi.fn(), logDriveAccess: vi.fn(), toDriveFile: vi.fn(), DriveError }
})
vi.mock('@/lib/drive/folders', () => ({ homeFolder: vi.fn() }))
vi.mock('@/lib/drive/gallery', () => ({ insertGalleryImage: vi.fn() }))
vi.mock('@/lib/drive/http', () => ({ driveActor: vi.fn(), driveFailure: vi.fn(), reqMeta: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({ GALLERY_MAX_BYTES: 10 }))

import { POST } from '@admin/app/api/(admin)/admin/drive/files/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { atLeast, folderLevel } from '@/lib/drive/access'
import { storeFile, logDriveAccess, toDriveFile, DriveError } from '@/lib/drive/files'
import { homeFolder } from '@/lib/drive/folders'
import { insertGalleryImage } from '@/lib/drive/gallery'
import { driveActor, driveFailure, reqMeta } from '@/lib/drive/http'
import { GALLERY_FOLDER_ID } from '@/lib/drive/types'

const ACTOR = { adminId: 'a1', role: 'admin', scopes: [] }
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const upload = (fields: Record<string, string | File>) => {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new NextRequest('http://localhost/api/admin/drive/files', { method: 'POST', body: form })
}
const png = (size = 3) => new File([new Uint8Array(size)], 'pic.png', { type: 'image/png' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(driveActor).mockResolvedValue(ACTOR as any)
  vi.mocked(driveFailure).mockReturnValue(NextResponse.json({ error: 'Upload failed' }, { status: 500 }))
  vi.mocked(reqMeta).mockReturnValue({ ip: null, userAgent: null } as any)
  vi.mocked(logDriveAccess).mockResolvedValue(undefined as any)
  vi.mocked(toDriveFile).mockImplementation((r: any) => ({ id: r.id }) as any)
  vi.mocked(homeFolder).mockResolvedValue('home' as any)
  vi.mocked(folderLevel).mockResolvedValue('edit' as any)
  vi.mocked(atLeast).mockReturnValue(true)
  vi.mocked(authenticateAdmin).mockResolvedValue(ACTOR as any)
  vi.mocked(hasScope).mockReturnValue(true)
})

describe('POST /api/admin/drive/files', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(driveActor).mockResolvedValueOnce(deny(401))
    expect((await POST(upload({ file: png() }))).status).toBe(401)
    vi.mocked(driveActor).mockResolvedValueOnce(deny(403))
    expect((await POST(upload({ file: png() }))).status).toBe(403)
    expect(driveActor).toHaveBeenCalledWith(expect.anything(), 'drive:write')
  })

  it('returns 400 when no file is sent', async () => {
    expect((await POST(upload({ folderId: 'x' }))).status).toBe(400)
    expect(storeFile).not.toHaveBeenCalled()
  })

  it('stores the file in the uploader home folder by default and logs the upload', async () => {
    vi.mocked(storeFile).mockResolvedValue({ id: 'f1' } as any)
    const res = await POST(upload({ file: png() }))
    expect(await res.json()).toEqual({ file: { id: 'f1', access: 'manage' } })
    expect(storeFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'pic.png', mime: 'image/png', folderId: 'home', source: 'upload', adminId: 'a1' }))
    expect(logDriveAccess).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f1', adminId: 'a1', action: 'upload' }))
  })

  it('returns 403 without edit access on the target folder', async () => {
    vi.mocked(atLeast).mockReturnValue(false)
    expect((await POST(upload({ file: png(), folderId: 'locked' }))).status).toBe(403)
    expect(folderLevel).toHaveBeenCalledWith(ACTOR, 'locked')
    expect(storeFile).not.toHaveBeenCalled()
  })

  it('surfaces a DriveError status and maps other failures through driveFailure', async () => {
    vi.mocked(storeFile).mockRejectedValueOnce(new DriveError('Too big', 413))
    const big = await POST(upload({ file: png() }))
    expect(big.status).toBe(413)
    expect((await big.json()).error).toBe('Too big')
    vi.mocked(storeFile).mockRejectedValueOnce(new Error('s3'))
    expect((await POST(upload({ file: png() }))).status).toBe(500)
    expect(driveFailure).toHaveBeenCalledWith(expect.any(Error), 'Upload')
  })

  describe('into the gallery', () => {
    it('returns 403 without a gallery-capable scope', async () => {
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await POST(upload({ file: png(), folderId: GALLERY_FOLDER_ID }))).status).toBe(403)
      expect(insertGalleryImage).not.toHaveBeenCalled()
    })

    it('returns 415 for a non-image and 413 for an oversized image', async () => {
      const pdf = new File([new Uint8Array(2)], 'a.pdf', { type: 'application/pdf' })
      expect((await POST(upload({ file: pdf, folderId: GALLERY_FOLDER_ID }))).status).toBe(415)
      expect((await POST(upload({ file: png(50), folderId: GALLERY_FOLDER_ID }))).status).toBe(413)
      expect(insertGalleryImage).not.toHaveBeenCalled()
    })

    it('publishes the image through the gallery pipeline', async () => {
      vi.mocked(insertGalleryImage).mockResolvedValue({ id: 'g1', image_url: 'https://cdn.test/g1.png' } as any)
      const res = await POST(upload({ file: png(), folderId: GALLERY_FOLDER_ID }))
      expect(await res.json()).toEqual({ gallery: { id: 'g1', url: 'https://cdn.test/g1.png' } })
      expect(insertGalleryImage).toHaveBeenCalledWith(expect.any(Buffer), 'pic.png', 'image/png', { customName: 'pic' })
      expect(storeFile).not.toHaveBeenCalled()
    })
  })
})
