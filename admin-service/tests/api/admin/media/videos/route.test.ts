import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/gallery-videos', () => {
  class GalleryVideoError extends Error { status = 422 }
  return { GalleryVideoError, listGalleryVideos: vi.fn(), registerGalleryVideo: vi.fn() }
})

import { GET, POST } from '@admin/app/api/(admin)/admin/media/videos/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { GalleryVideoError, listGalleryVideos, registerGalleryVideo } from '@/lib/shared/gallery-videos'

const UUID = '11111111-1111-4111-8111-111111111111'
const get = (qs = '') => new NextRequest(`http://localhost/api/admin/media/videos${qs}`)
const post = (body: unknown) => new NextRequest('http://localhost/api/admin/media/videos', { method: 'POST', body: JSON.stringify(body) })
const good = { key: 'media/video/a.mp4', mimeType: 'video/mp4', durationSeconds: 12, label: 'Promo' }

describe('media/videos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: UUID, role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(listGalleryVideos).mockResolvedValue({ videos: [{ id: 'v1' }], total: 1 } as any)
    vi.mocked(registerGalleryVideo).mockResolvedValue({ id: 'v1' } as any)
  })

  it('GET 401s without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(get())).status).toBe(401)
  })

  it('GET pages, clamps the limit and trims the search', async () => {
    const j = await (await GET(get('?page=3&limit=500&search=%20promo%20'))).json()
    expect(j).toEqual({ videos: [{ id: 'v1' }], total: 1, page: 3, limit: 100 })
    expect(listGalleryVideos).toHaveBeenCalledWith({ limit: 100, offset: 200, search: 'promo' })
    await GET(get('?page=-1&limit=0'))
    expect(listGalleryVideos).toHaveBeenLastCalledWith({ limit: 24, offset: 0, search: undefined })
  })

  it('POST 401s and 403s without any gallery write scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(post(good))).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: UUID, role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(post(good))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'settings:write')
    expect(hasScope).toHaveBeenCalledWith('m', [], 'templates:write')
    expect(registerGalleryVideo).not.toHaveBeenCalled()
  })

  it('POST 400s on an invalid body', async () => {
    expect((await POST(post({ ...good, mimeType: 'video/avi' }))).status).toBe(400)
    expect((await POST(post({ mimeType: 'video/mp4' }))).status).toBe(400)
    expect((await POST(post({ ...good, posterUrl: 'not-a-url' }))).status).toBe(400)
  })

  it('POST registers the upload as the admin', async () => {
    expect(await (await POST(post(good))).json()).toEqual({ video: { id: 'v1' } })
    expect(registerGalleryVideo).toHaveBeenCalledWith(expect.objectContaining({ key: 'media/video/a.mp4', mime: 'video/mp4', durationSeconds: 12, label: 'Promo', createdBy: UUID }))
  })

  it('POST records no creator for a non-uuid admin id', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'env-admin', role: 'm', scopes: [] } as any)
    await POST(post(good))
    expect(registerGalleryVideo).toHaveBeenCalledWith(expect.objectContaining({ createdBy: null }))
  })

  it('POST maps a registration error to its status, and unknown errors to 500', async () => {
    vi.mocked(registerGalleryVideo).mockRejectedValueOnce(new GalleryVideoError('Too big'))
    const res = await POST(post(good))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Too big' })
    vi.mocked(registerGalleryVideo).mockRejectedValueOnce(new Error('s3 down'))
    expect((await POST(post(good))).status).toBe(500)
  })
})
