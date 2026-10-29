import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// A small cap so the size check is cheap to exercise.
const MAX = vi.hoisted(() => 64)

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({
  uploadGalleryMedia: vi.fn(),
  fetchRemoteImage: vi.fn(),
  GALLERY_MAX_BYTES: MAX,
}))

import { POST, OPTIONS } from '@/app/api/(public)/gallery/upload/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { uploadGalleryMedia, fetchRemoteImage } from '@/lib/shared/s3'
import { queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockUpload = vi.mocked(uploadGalleryMedia)
const mockFetchRemoteImage = vi.mocked(fetchRemoteImage)
const mockQueryOne = vi.mocked(queryOne)

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['products:write'] }

const uploadResult = {
  url: 'https://cdn/gallery/img.jpg',
  thumbnailUrl: 'https://cdn/gallery/thumb_img.jpg',
  s3Key: 'gallery/img.jpg',
  s3ThumbnailKey: 'gallery/thumb_img.jpg',
  fileName: 'img.jpg',
  fileSize: 1024,
  width: 800,
  height: 600,
  mimeType: 'image/png',
  blurhash: 'LEHV6nWB2yk8',
}

const insertedRecord = { id: 'new-id', image_url: uploadResult.url, s3_key: uploadResult.s3Key }

function jsonReq(body: object) {
  return new NextRequest('http://localhost/api/gallery/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function formReq(fields: Record<string, string | File> = {}) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return new NextRequest('http://localhost/api/gallery/upload', { method: 'POST', body: fd })
}

const png = (bytes = 'imgdata', name = 'photo.png') => new File([bytes], name, { type: 'image/png' })

describe('OPTIONS /api/gallery/upload', () => {
  it('returns 204', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
  })
})

describe('POST /api/gallery/upload', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN)
    mockHasScope.mockReturnValue(true)
    process.env.S3_BUCKET_NAME = 'test-bucket'
  })

  it('401 when not an admin', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(jsonReq({ imageUrl: 'https://example.com/img.jpg' }))
    expect(res.status).toBe(401)
  })

  it('403 when the admin/token holds none of the gallery write scopes', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(jsonReq({ imageUrl: 'https://example.com/img.jpg' }))
    expect(res.status).toBe(403)
    expect(mockFetchRemoteImage).not.toHaveBeenCalled()
  })

  it('a coupons:write editor may upload', async () => {
    mockHasScope.mockImplementation((_r, _s, scope) => scope === 'coupons:write')
    mockUpload.mockResolvedValue(uploadResult as any)
    mockQueryOne.mockResolvedValue(insertedRecord)
    const res = await POST(formReq({ file: png() }))
    expect(res.status).toBe(200)
  })

  it('400 when the JSON body has no imageUrl', async () => {
    const res = await POST(jsonReq({}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('imageUrl')
  })

  it('400 when the form has no file', async () => {
    const res = await POST(formReq())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('No file')
  })

  it('413 when the file is over the size limit, before uploading', async () => {
    const res = await POST(formReq({ file: png('x'.repeat(MAX + 1)) }))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toMatch(/up to/i)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('accepts a file exactly at the limit', async () => {
    mockUpload.mockResolvedValue(uploadResult as any)
    mockQueryOne.mockResolvedValue(insertedRecord)
    const res = await POST(formReq({ file: png('x'.repeat(MAX)) }))
    expect(res.status).toBe(200)
  })

  it('uploads a form file and inserts the record', async () => {
    mockUpload.mockResolvedValue(uploadResult as any)
    mockQueryOne.mockResolvedValue(insertedRecord)
    const res = await POST(formReq({ file: png(), customName: 'My Photo', categoryId: 'cat1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('new-id')
    expect(mockUpload).toHaveBeenCalledWith(expect.any(Buffer), 'photo.png', 'image/png')
    const args = mockQueryOne.mock.calls[0][1]!
    expect(args[4]).toBe('test-bucket')
    expect(args[10]).toBe(uploadResult.blurhash)
    expect(args.slice(11)).toEqual([null, 'My Photo', 'cat1'])
  })

  it('uploads from a JSON imageUrl, naming the file from the URL', async () => {
    mockUpload.mockResolvedValue(uploadResult as any)
    mockQueryOne.mockResolvedValue(insertedRecord)
    mockFetchRemoteImage.mockResolvedValue(Buffer.from('fakeimagedata'))
    const res = await POST(jsonReq({ imageUrl: 'https://example.com/a/photo.jpg', customName: 'My Photo', categoryId: 'cat-2' }))
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('new-id')
    expect(mockFetchRemoteImage).toHaveBeenCalledWith('https://example.com/a/photo.jpg')
    expect(mockUpload).toHaveBeenCalledWith(expect.any(Buffer), 'photo.jpg', '')
    expect(mockQueryOne.mock.calls[0][1]!.slice(11)).toEqual(['https://example.com/a/photo.jpg', 'My Photo', 'cat-2'])
  })

  it('passes through the status of a failed remote fetch', async () => {
    mockFetchRemoteImage.mockRejectedValue(Object.assign(new Error('The file is larger than 20 MB'), { status: 413 }))
    const res = await POST(jsonReq({ imageUrl: 'https://example.com/huge.jpg' }))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('The file is larger than 20 MB')
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('passes through the status of a rejected upload', async () => {
    mockUpload.mockRejectedValue(Object.assign(new Error('Unsupported file type'), { status: 415 }))
    const res = await POST(formReq({ file: png() }))
    expect(res.status).toBe(415)
    expect((await res.json()).error).toBe('Unsupported file type')
  })

  it('500 when the upload throws without a status', async () => {
    mockUpload.mockRejectedValue(new Error('S3 error'))
    const res = await POST(formReq({ file: png('d', 'x.png') }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('S3 error')
  })

  it('500 with a generic message when the error has none', async () => {
    mockUpload.mockRejectedValue({})
    const res = await POST(formReq({ file: png('d', 'x.png') }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Upload failed')
  })

  it('500 when the remote fetch fails', async () => {
    mockFetchRemoteImage.mockRejectedValue(new Error('Failed to fetch image: 404'))
    const res = await POST(jsonReq({ imageUrl: 'https://example.com/missing.jpg' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Failed to fetch image')
  })
})
