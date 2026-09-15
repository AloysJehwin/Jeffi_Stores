import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/s3', () => ({
  uploadVariantImage: vi.fn(),
  deleteProductImage: vi.fn(),
  getS3Url: vi.fn((key: string) => `https://cdn.example.com/${key}`),
  currentBucket: vi.fn().mockResolvedValue('jeffi-stores-bucket'),
}))

import { GET, POST, DELETE, PATCH } from '@/app/api/admin/products/[id]/variants/[variantId]/images/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, query } from '@/lib/db'
import { uploadVariantImage, deleteProductImage } from '@/lib/s3'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockQuery = vi.mocked(query)
const mockUploadVariantImage = vi.mocked(uploadVariantImage)
const mockDeleteProductImage = vi.mocked(deleteProductImage)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const params = Promise.resolve({ id: 'prod-1', variantId: 'var-1' })
const baseUrl = 'http://localhost/api/admin/products/prod-1/variants/var-1/images'

// Valid v4 UUIDs — zod requires version nibble 1-8 in position 13
const UUID1 = '00000000-0000-4000-8000-000000000001'
const UUID2 = '00000000-0000-4000-8000-000000000002'

function makeGetReq() {
  return new NextRequest(baseUrl)
}

function makeJsonReq(method: string, body: unknown) {
  return new NextRequest(baseUrl, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.resetAllMocks() })

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
describe('GET /api/admin/products/[id]/variants/[variantId]/images', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(403)
  })

  it('returns empty images list when none exist', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.images).toEqual([])
  })

  it('returns images ordered by display_order', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const images = [
      { id: 'img-1', display_order: 0, is_primary: true },
      { id: 'img-2', display_order: 1, is_primary: false },
    ]
    mockQueryMany.mockResolvedValue(images)
    const res = await GET(makeGetReq(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.images).toEqual(images)
  })
})

// ---------------------------------------------------------------------------
// POST (multipart/form-data file upload)
// ---------------------------------------------------------------------------
describe('POST /api/admin/products/[id]/variants/[variantId]/images (file upload)', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const req = new NextRequest(baseUrl, { method: 'POST' })
    const res = await POST(req, { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const req = new NextRequest(baseUrl, { method: 'POST' })
    const res = await POST(req, { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when variant not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)
    const req = new NextRequest(baseUrl, { method: 'POST' })
    const res = await POST(req, { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Variant/)
  })

  it('returns 400 when max images reached', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'var-1' })
    mockQueryMany.mockResolvedValueOnce([
      { id: 'i1' }, { id: 'i2' }, { id: 'i3' }, { id: 'i4' }, { id: 'i5' },
    ])
    const req = new NextRequest(baseUrl, { method: 'POST' })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Maximum/)
  })

  it('returns 400 when no file provided in form-data', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'var-1' })
    mockQueryMany.mockResolvedValueOnce([])
    const formData = new FormData()
    const req = new NextRequest(baseUrl, { method: 'POST', body: formData })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/No file/)
  })

  it('uploads file and inserts image on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'img-new', variant_id: 'var-1', is_primary: true })
    mockQueryMany.mockResolvedValueOnce([])
    mockUploadVariantImage.mockResolvedValue({
      url: 'https://cdn.example.com/v/var-1/img.jpg',
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      thumbnailUrl: 'https://cdn.example.com/v/var-1/img_thumb.jpg',
      s3Bucket: 'jeffi-stores-bucket',
      s3Key: 'v/var-1/img.jpg',
      s3ThumbnailKey: 'v/var-1/img_thumb.jpg',
      fileName: 'img.jpg',
      fileSize: 12345,
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    })
    const formData = new FormData()
    const file = new File(['binary'], 'img.jpg', { type: 'image/jpeg' })
    formData.append('file', file)
    const req = new NextRequest(baseUrl, { method: 'POST', body: formData })
    const res = await POST(req, { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.image).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// POST (application/json — gallery image)
// ---------------------------------------------------------------------------
describe('POST /api/admin/products/[id]/variants/[variantId]/images (gallery)', () => {
  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'var-1' })
    mockQueryMany.mockResolvedValueOnce([])
    const req = new NextRequest(baseUrl, {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 when gallery_image_id is not a UUID', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'var-1' })
    mockQueryMany.mockResolvedValueOnce([])
    const res = await POST(makeJsonReq('POST', { gallery_image_id: 'not-a-uuid' }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 404 when gallery image not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })  // variant check
      .mockResolvedValueOnce(null)              // gallery image not found
    mockQueryMany.mockResolvedValueOnce([])
    const res = await POST(makeJsonReq('POST', { gallery_image_id: UUID1 }), { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Gallery image/)
  })

  it('returns 400 when gallery image has no usable URL', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'gimg-1', image_url: null, s3_key: null, thumbnail_url: null, s3_thumbnail_key: null })
    mockQueryMany.mockResolvedValueOnce([])
    const res = await POST(makeJsonReq('POST', { gallery_image_id: UUID1 }), { params })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no usable URL/)
  })

  it('returns 410 when gallery image file is missing from storage', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'gimg-1', image_url: 'https://cdn.example.com/missing.jpg', thumbnail_url: null, s3_key: null, s3_thumbnail_key: null })
    mockQueryMany.mockResolvedValueOnce([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const res = await POST(makeJsonReq('POST', { gallery_image_id: UUID1 }), { params })
    expect(res.status).toBe(410)
    vi.unstubAllGlobals()
  })

  it('returns 502 when gallery image storage is unreachable', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({ id: 'gimg-1', image_url: 'https://cdn.example.com/img.jpg', thumbnail_url: null, s3_key: null, s3_thumbnail_key: null })
    mockQueryMany.mockResolvedValueOnce([])
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const res = await POST(makeJsonReq('POST', { gallery_image_id: UUID1 }), { params })
    expect(res.status).toBe(502)
    vi.unstubAllGlobals()
  })

  it('inserts gallery image on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({
        id: 'gimg-1',
        image_url: 'https://cdn.example.com/img.jpg',
        thumbnail_url: 'https://cdn.example.com/img_thumb.jpg',
        s3_key: 'gallery/img.jpg',
        s3_thumbnail_key: 'gallery/img_thumb.jpg',
        custom_name: null,
        file_name: 'img.jpg',
        file_size: 5000,
        mime_type: 'image/jpeg',
        width: 400,
        height: 300,
      })
      .mockResolvedValueOnce({ id: 'img-new', is_primary: true })
    mockQueryMany.mockResolvedValueOnce([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const res = await POST(makeJsonReq('POST', { gallery_image_id: UUID1 }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.image).toBeDefined()
    vi.unstubAllGlobals()
  })

  it('uses s3 key to build URL when image_url absent', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1' })
      .mockResolvedValueOnce({
        id: 'gimg-2',
        image_url: null,
        thumbnail_url: null,
        s3_key: 'gallery/img2.jpg',
        s3_thumbnail_key: 'gallery/img2_thumb.jpg',
        custom_name: 'custom.jpg',
        file_name: 'img2.jpg',
        file_size: 3000,
        mime_type: 'image/jpeg',
        width: 200,
        height: 150,
      })
      .mockResolvedValueOnce({ id: 'img-new2', is_primary: true })
    mockQueryMany.mockResolvedValueOnce([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const res = await POST(makeJsonReq('POST', { gallery_image_id: UUID2 }), { params })
    expect(res.status).toBe(200)
    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('DELETE /api/admin/products/[id]/variants/[variantId]/images', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(makeJsonReq('DELETE', { imageId: UUID1 }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeJsonReq('DELETE', { imageId: UUID1 }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const req = new NextRequest(baseUrl, {
      method: 'DELETE',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await DELETE(req, { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 when imageId is not a valid UUID', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await DELETE(makeJsonReq('DELETE', { imageId: 'not-a-uuid' }), { params })
    expect(res.status).toBe(400)
  })

  it('returns 404 when image not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await DELETE(makeJsonReq('DELETE', { imageId: UUID1 }), { params })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Image/)
  })

  it('deletes image without s3_key and no primary promotion', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ id: 'img-1', s3_key: null, s3_thumbnail_key: null, is_primary: false })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await DELETE(makeJsonReq('DELETE', { imageId: UUID1 }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockDeleteProductImage).not.toHaveBeenCalled()
  })

  it('deletes s3 key and promotes next image when primary deleted', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({
      id: 'img-1',
      s3_key: 'v/var-1/img.jpg',
      s3_thumbnail_key: 'v/var-1/img_thumb.jpg',
      is_primary: true,
    })
    mockDeleteProductImage.mockResolvedValue(undefined)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await DELETE(makeJsonReq('DELETE', { imageId: UUID1 }), { params })
    expect(res.status).toBe(200)
    expect(mockDeleteProductImage).toHaveBeenCalledWith('v/var-1/img.jpg', 'v/var-1/img_thumb.jpg')
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('deletes image with s3_key but not primary (no promotion)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({
      id: 'img-2',
      s3_key: 'v/var-1/img2.jpg',
      s3_thumbnail_key: 'v/var-1/img2_thumb.jpg',
      is_primary: false,
    })
    mockDeleteProductImage.mockResolvedValue(undefined)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await DELETE(makeJsonReq('DELETE', { imageId: UUID2 }), { params })
    expect(res.status).toBe(200)
    expect(mockDeleteProductImage).toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/products/[id]/variants/[variantId]/images', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makeJsonReq('PATCH', { imageId: UUID1, isPrimary: true }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makeJsonReq('PATCH', { imageId: UUID1 }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const req = new NextRequest(baseUrl, {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 when imageId is not a UUID', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makeJsonReq('PATCH', { imageId: 'bad' }), { params })
    expect(res.status).toBe(400)
  })

  it('sets isPrimary on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await PATCH(makeJsonReq('PATCH', { imageId: UUID1, isPrimary: true }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('updates displayOrder on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await PATCH(makeJsonReq('PATCH', { imageId: UUID1, displayOrder: 2 }), { params })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('updates both isPrimary and displayOrder', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await PATCH(makeJsonReq('PATCH', {
      imageId: UUID1,
      isPrimary: true,
      displayOrder: 0,
    }), { params })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })

  it('succeeds with only imageId (no isPrimary, no displayOrder)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await PATCH(makeJsonReq('PATCH', { imageId: UUID1 }), { params })
    expect(res.status).toBe(200)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
