import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({ GALLERY_VIDEO_MAX_BYTES: 50 * 1024 * 1024, presignGalleryVideoUpload: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/media/videos/upload-url/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { presignGalleryVideoUpload } from '@/lib/shared/s3'

const req = (body: unknown) => new NextRequest('http://localhost/api/admin/media/videos/upload-url', { method: 'POST', body: JSON.stringify(body) })
const good = { mimeType: 'video/mp4', size: 1000 }

describe('POST media/videos/upload-url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(presignGalleryVideoUpload).mockResolvedValue({ uploadUrl: 'https://s3/put', key: 'media/video/x.mp4' } as any)
  })

  it('401s and 403s without any gallery write scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(good))).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req(good))).status).toBe(403)
    expect(presignGalleryVideoUpload).not.toHaveBeenCalled()
  })

  it('400s on a bad type or size, 413s over 50 MB', async () => {
    expect((await POST(req({ mimeType: 'video/avi', size: 10 }))).status).toBe(400)
    expect((await POST(req({ mimeType: 'video/mp4', size: 0 }))).status).toBe(400)
    expect((await POST(req(null))).status).toBe(400)
    expect((await POST(req({ mimeType: 'video/webm', size: 50 * 1024 * 1024 + 1 }))).status).toBe(413)
    expect(presignGalleryVideoUpload).not.toHaveBeenCalled()
  })

  it('returns a presigned upload with the declared type', async () => {
    const j = await (await POST(req(good))).json()
    expect(j).toEqual({ uploadUrl: 'https://s3/put', key: 'media/video/x.mp4', mimeType: 'video/mp4', maxBytes: 50 * 1024 * 1024 })
    expect(presignGalleryVideoUpload).toHaveBeenCalledWith('video/mp4', 1000)
  })

  it('500s when presigning fails', async () => {
    vi.mocked(presignGalleryVideoUpload).mockRejectedValue(new Error('no creds'))
    const res = await POST(req(good))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'no creds' })
  })
})
