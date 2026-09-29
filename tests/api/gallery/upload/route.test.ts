import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
  authenticateAnyUser: vi.fn(),
  authenticateUser: vi.fn(),
  verifyToken: vi.fn(),
}))
vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(() => true),
}))
vi.mock('@/lib/s3', () => ({
  uploadGalleryImage: vi.fn(),
  deleteGalleryImage: vi.fn(),
  fetchRemoteImage: vi.fn(),
}))

import { POST, OPTIONS } from '@/app/api/gallery/upload/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { uploadGalleryImage, fetchRemoteImage } from '@/lib/s3'
import { queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockUpload = vi.mocked(uploadGalleryImage)
const mockFetchRemoteImage = vi.mocked(fetchRemoteImage)
const mockQueryOne = vi.mocked(queryOne)

const uploadResult = {
  url: 'https://cdn/gallery/img.jpg',
  thumbnailUrl: 'https://cdn/gallery/thumb_img.jpg',
  s3Key: 'gallery/img.jpg',
  s3ThumbnailKey: 'gallery/thumb_img.jpg',
  fileName: 'img.jpg',
  fileSize: 1024,
  width: 800,
  height: 600,
}

const insertedRecord = {
  id: 'new-id',
  image_url: uploadResult.url,
  s3_key: uploadResult.s3Key,
}

describe('OPTIONS /api/gallery/upload', () => {
  it('returns 204', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
  })
})

describe('POST /api/gallery/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasScope.mockReturnValue(true) // cleared by clearAllMocks; default to allowed
    process.env.S3_BUCKET_NAME = 'test-bucket'
  })

  it('returns 401 when not admin', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const req = new Request('http://localhost/api/gallery/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'https://example.com/img.jpg' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the admin/token lacks products:write', async () => {
    mockAuth.mockResolvedValueOnce({ adminId: 'a1', role: 'admin', scopes: [] } as any)
    mockHasScope.mockReturnValueOnce(false)
    const req = new Request('http://localhost/api/gallery/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'https://example.com/img.jpg' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })

  it('returns 400 when JSON body missing imageUrl', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    const req = new Request('http://localhost/api/gallery/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('imageUrl')
  })

  it('returns 400 when multipart has no file', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    const fd = new FormData()
    const req = new Request('http://localhost/api/gallery/upload', {
      method: 'POST',
      body: fd,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('No file')
  })

  it('uploads via multipart and inserts record', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockUpload.mockResolvedValueOnce(uploadResult as any)
    mockQueryOne.mockResolvedValueOnce(insertedRecord)

    const fd = new FormData()
    const file = new File(['imgdata'], 'photo.png', { type: 'image/png' })
    fd.append('file', file)
    fd.append('customName', 'My Photo')
    fd.append('categoryId', 'cat1')

    const req = new Request('http://localhost/api/gallery/upload', {
      method: 'POST',
      body: fd,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBe('new-id')
    expect(mockUpload).toHaveBeenCalledWith(expect.any(Buffer), 'photo.png')
  })

  it('returns 500 when upload throws', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockUpload.mockRejectedValueOnce(new Error('S3 error'))

    const fd = new FormData()
    fd.append('file', new File(['d'], 'x.png', { type: 'image/png' }))

    const req = new Request('http://localhost/api/gallery/upload', {
      method: 'POST',
      body: fd,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('S3 error')
  })

  it('returns 500 with generic message when error has no message', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockUpload.mockRejectedValueOnce({})

    const fd = new FormData()
    fd.append('file', new File(['d'], 'x.png', { type: 'image/png' }))

    const req = new Request('http://localhost/api/gallery/upload', {
      method: 'POST',
      body: fd,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Upload failed')
  })

  it('uploads via JSON imageUrl and inserts record', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockUpload.mockResolvedValueOnce(uploadResult as any)
    mockQueryOne.mockResolvedValueOnce(insertedRecord)

    // The route fetches the remote image via s3.fetchRemoteImage (shared with the bulk importer),
    // not global.fetch. Drive the helper directly.
    mockFetchRemoteImage.mockResolvedValueOnce(Buffer.from('fakeimagedata') as any)

    const req = new Request('http://localhost/api/gallery/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageUrl: 'https://example.com/photo.jpg',
        customName: 'My Photo',
        categoryId: 'cat-2',
      }),
    })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBe('new-id')
    expect(mockUpload).toHaveBeenCalledOnce()
  })

  it('returns 500 when fetchImage fails (non-ok response)', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockFetchRemoteImage.mockRejectedValueOnce(new Error('Failed to fetch image: 404'))

    const req = new Request('http://localhost/api/gallery/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'https://example.com/missing.jpg' }),
    })
    const res = await POST(req as any)

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toContain('Failed to fetch image')
  })
})
