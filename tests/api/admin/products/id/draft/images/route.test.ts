import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/s3', () => ({
  uploadProductImage: vi.fn(),
  copyGalleryImageToProduct: vi.fn(),
}))

import { GET, POST, DELETE, PATCH } from '@/app/api/admin/products/[id]/draft/images/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { uploadProductImage, copyGalleryImageToProduct } from '@/lib/s3'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockUpload = vi.mocked(uploadProductImage)
const mockCopy = vi.mocked(copyGalleryImageToProduct)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const PRODUCT_ID = 'prod-1'
const UUID1 = '00000000-0000-4000-8000-000000000001'

function params() {
  return { params: Promise.resolve({ id: PRODUCT_ID }) }
}

const URL = `http://localhost/api/admin/products/${PRODUCT_ID}/draft/images`

function getReq() {
  return new NextRequest(URL)
}

function jsonReq(method: string, body: unknown) {
  return new NextRequest(URL, {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function formReq(form: FormData) {
  return new NextRequest(URL, { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(admin as any)
  mockHasScope.mockReturnValue(true)
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)
})

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
describe('GET /api/admin/products/[id]/draft/images', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(getReq(), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(getReq(), params())
    expect(res.status).toBe(403)
  })

  it('returns empty list when no draft row exists', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(getReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).images).toEqual([])
  })

  it('returns empty list when draft images is not an array', async () => {
    mockQueryOne.mockResolvedValueOnce({ images: null } as any)
    const res = await GET(getReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).images).toEqual([])
  })

  it('sorts by display_order', async () => {
    mockQueryOne.mockResolvedValueOnce({
      images: [
        { id: 'i2', display_order: 1 },
        { id: 'i1', display_order: 0 },
        { id: 'i3' }, // missing display_order → 0
      ],
    } as any)
    const res = await GET(getReq(), params())
    expect(res.status).toBe(200)
    const { images } = await res.json()
    expect(images.map((i: any) => i.id)).toEqual(['i1', 'i3', 'i2'])
  })
})

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
describe('POST /api/admin/products/[id]/draft/images', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(jsonReq('POST', {}), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(jsonReq('POST', {}), params())
    expect(res.status).toBe(403)
  })

  it('returns 400 when max images reached', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }))
    mockQueryOne.mockResolvedValueOnce({ images: five } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Maximum/)
  })

  it('returns 400 on invalid JSON', async () => {
    mockQueryOne.mockResolvedValueOnce({ images: [] } as any)
    const res = await POST(jsonReq('POST', 'not-json'), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid JSON/)
  })

  it('returns 400 when gallery_image_id is not a UUID', async () => {
    mockQueryOne.mockResolvedValueOnce({ images: [] } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: 'nope' }), params())
    expect(res.status).toBe(400)
  })

  it('returns 404 when gallery image not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ images: [] } as any)
      .mockResolvedValueOnce(null)
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }), params())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/Gallery image not found/)
  })

  it('returns 400 when gallery image has no s3_key', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ images: [] } as any)
      .mockResolvedValueOnce({ id: 'g1', s3_key: null } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no usable source/)
  })

  it('copies a gallery image to the product prefix as primary and saves', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ images: [] } as any)
      .mockResolvedValueOnce({
        id: 'g1', s3_key: 'gallery/img.jpg', s3_thumbnail_key: 'gallery/t.jpg',
        custom_name: 'nice.jpg', file_name: 'img.jpg',
        file_size: 100, mime_type: 'image/jpeg', width: 10, height: 20,
      } as any)
    mockCopy.mockResolvedValue({
      s3Bucket: 'bucket', s3Key: 'products/prod-1/img.jpg', s3ThumbnailKey: 'products/prod-1/t.jpg',
      url: 'https://cdn/p.jpg', thumbnailUrl: 'https://cdn/pt.jpg',
    } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }), params())
    expect(res.status).toBe(200)
    const { image } = await res.json()
    expect(image.is_primary).toBe(true)
    expect(image.display_order).toBe(0)
    expect(image.image_url).toBe('https://cdn/p.jpg')
    expect(image.s3_key).toBe('products/prod-1/img.jpg')
    expect(image.file_name).toBe('nice.jpg') // custom_name wins
    expect(image._fromGallery).toBe(true)
    expect(image._staged).toBe(true)
    expect(mockCopy).toHaveBeenCalledWith('gallery/img.jpg', 'gallery/t.jpg', PRODUCT_ID)
    expect(mockQuery).toHaveBeenCalled()
  })

  it('gallery image is not primary when others already exist', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ images: [{ id: 'x' }] } as any)
      .mockResolvedValueOnce({
        id: 'g2', s3_key: 'gallery/img2.jpg', s3_thumbnail_key: 'gallery/t2.jpg',
        custom_name: null, file_name: 'img2.jpg',
        file_size: 50, mime_type: 'image/png', width: 5, height: 6,
      } as any)
    mockCopy.mockResolvedValue({
      s3Bucket: 'bucket', s3Key: 'products/prod-1/img2.jpg', s3ThumbnailKey: 'products/prod-1/t2.jpg',
      url: 'https://cdn/p2.jpg', thumbnailUrl: 'https://cdn/pt2.jpg',
    } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }), params())
    expect(res.status).toBe(200)
    const { image } = await res.json()
    expect(image.is_primary).toBe(false)
    expect(image.display_order).toBe(1)
    expect(image.file_name).toBe('img2.jpg')
  })

  it('returns 400 when no file provided in form-data', async () => {
    mockQueryOne.mockResolvedValueOnce({ images: [] } as any)
    const res = await POST(formReq(new FormData()), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/No file provided/)
  })

  it('uploads a file and stages it as a fresh upload', async () => {
    mockQueryOne.mockResolvedValueOnce({ images: [] } as any)
    mockUpload.mockResolvedValue({
      url: 'https://cdn/u.jpg', thumbnailUrl: 'https://cdn/ut.jpg',
      s3Bucket: 'bucket', s3Key: 's3k', s3ThumbnailKey: 's3tk', fileName: 'u.jpg',
      fileSize: 999, mimeType: 'image/jpeg', width: 100, height: 200,
    } as any)
    const form = new FormData()
    form.append('file', new File(['bytes'], 'u.jpg', { type: 'image/jpeg' }))
    const res = await POST(formReq(form), params())
    expect(res.status).toBe(200)
    const { image } = await res.json()
    expect(image._staged).toBe(true)
    expect(image.is_primary).toBe(true)
    expect(image.image_url).toBe('https://cdn/u.jpg')
    expect(image.s3_key).toBe('s3k')
    expect(mockUpload).toHaveBeenCalledWith(expect.any(File), PRODUCT_ID)
  })

  it('returns 500 when upload throws', async () => {
    mockQueryOne.mockResolvedValueOnce({ images: [] } as any)
    mockUpload.mockRejectedValue(new Error('s3 down'))
    const form = new FormData()
    form.append('file', new File(['bytes'], 'u.jpg', { type: 'image/jpeg' }))
    const res = await POST(formReq(form), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/s3 down/)
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('DELETE /api/admin/products/[id]/draft/images', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }), params())
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await DELETE(jsonReq('DELETE', 'not-json'), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid JSON/)
  })

  it('returns 400 when imageId missing from body', async () => {
    const res = await DELETE(jsonReq('DELETE', {}), params())
    expect(res.status).toBe(400)
  })

  it('removes a non-primary image without promoting', async () => {
    mockQueryOne.mockResolvedValueOnce({
      images: [
        { id: 'i1', is_primary: true, display_order: 0 },
        { id: 'i2', is_primary: false, display_order: 1 },
      ],
    } as any)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i2' }), params())
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved.map((v: any) => v.id)).toEqual(['i1'])
    expect(saved.find((v: any) => v.id === 'i1').is_primary).toBe(true)
  })

  it('promotes the first remaining image when the primary is deleted', async () => {
    mockQueryOne.mockResolvedValueOnce({
      images: [
        { id: 'i1', is_primary: true, display_order: 0 },
        { id: 'i3', is_primary: false, display_order: 2 },
        { id: 'i2', is_primary: false, display_order: 1 },
      ],
    } as any)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved.find((v: any) => v.id === 'i2').is_primary).toBe(true)
    expect(saved.find((v: any) => v.id === 'i3').is_primary).toBe(false)
  })

  it('deleting the primary with no survivors just removes it', async () => {
    mockQueryOne.mockResolvedValueOnce({
      images: [{ id: 'i1', is_primary: true, display_order: 0 }],
    } as any)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/products/[id]/draft/images', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i1' }), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i1' }), params())
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await PATCH(jsonReq('PATCH', 'not-json'), params())
    expect(res.status).toBe(400)
  })

  it('returns 400 when imageId missing', async () => {
    const res = await PATCH(jsonReq('PATCH', { isPrimary: true }), params())
    expect(res.status).toBe(400)
  })

  it('setting isPrimary makes exactly the target primary', async () => {
    mockQueryOne.mockResolvedValueOnce({
      images: [
        { id: 'i1', is_primary: true },
        { id: 'i2', is_primary: false },
      ],
    } as any)
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i2', isPrimary: true }), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved.find((v: any) => v.id === 'i2').is_primary).toBe(true)
    expect(saved.find((v: any) => v.id === 'i1').is_primary).toBe(false)
  })

  it('updates display_order for the matching image only', async () => {
    mockQueryOne.mockResolvedValueOnce({
      images: [
        { id: 'i1', display_order: 0 },
        { id: 'i2', display_order: 1 },
      ],
    } as any)
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i2', displayOrder: 5 }), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved.find((v: any) => v.id === 'i2').display_order).toBe(5)
    expect(saved.find((v: any) => v.id === 'i1').display_order).toBe(0)
  })
})
