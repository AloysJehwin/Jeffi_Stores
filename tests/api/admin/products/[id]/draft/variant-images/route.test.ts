import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/shared/s3', () => ({
  uploadVariantImage: vi.fn(),
  getS3Url: vi.fn((key: string) => `https://cdn.example.com/${key}`),
  currentBucket: vi.fn().mockResolvedValue('jeffi-stores-bucket'),
}))

import { GET, POST, DELETE, PATCH } from '@/app/api/admin/products/[id]/draft/variant-images/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { uploadVariantImage } from '@/lib/shared/s3'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockUpload = vi.mocked(uploadVariantImage)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }
const PRODUCT_ID = 'prod-1'
const VARIANT_ID = 'var-1'
// Valid v4 UUID — zod requires version nibble 1-8 in position 13
const UUID1 = '00000000-0000-4000-8000-000000000001'

function params() {
  return { params: Promise.resolve({ id: PRODUCT_ID }) }
}

function url(variantId?: string) {
  const base = `http://localhost/api/admin/products/${PRODUCT_ID}/draft/variant-images`
  return variantId ? `${base}?variant_id=${variantId}` : base
}

function getReq(variantId?: string) {
  return new NextRequest(url(variantId))
}

function jsonReq(method: string, body: unknown, variantId?: string) {
  return new NextRequest(url(variantId), {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function formReq(form: FormData, variantId?: string) {
  return new NextRequest(url(variantId), { method: 'POST', body: form })
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
describe('GET /api/admin/products/[id]/draft/variant-images', () => {
  it('returns 400 when variant_id missing', async () => {
    const res = await GET(getReq(), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/variant_id required/)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(getReq(VARIANT_ID), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(getReq(VARIANT_ID), params())
    expect(res.status).toBe(403)
  })

  it('returns empty list when no draft row exists', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(getReq(VARIANT_ID), params())
    expect(res.status).toBe(200)
    expect((await res.json()).images).toEqual([])
  })

  it('returns empty list when draft variant_images is not an array', async () => {
    mockQueryOne.mockResolvedValueOnce({ variant_images: null } as any)
    const res = await GET(getReq(VARIANT_ID), params())
    expect(res.status).toBe(200)
    expect((await res.json()).images).toEqual([])
  })

  it('filters to the variant and sorts by display_order', async () => {
    mockQueryOne.mockResolvedValueOnce({
      variant_images: [
        { id: 'i2', variant_id: VARIANT_ID, display_order: 1 },
        { id: 'i1', variant_id: VARIANT_ID, display_order: 0 },
        { id: 'other', variant_id: 'var-2', display_order: 0 },
        { id: 'i3', variant_id: VARIANT_ID }, // missing display_order → 0
      ],
    } as any)
    const res = await GET(getReq(VARIANT_ID), params())
    expect(res.status).toBe(200)
    const { images } = await res.json()
    expect(images.map((i: any) => i.id)).toEqual(['i1', 'i3', 'i2'])
    expect(images.every((i: any) => i.variant_id === VARIANT_ID)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
describe('POST /api/admin/products/[id]/draft/variant-images', () => {
  it('returns 400 when variant_id missing', async () => {
    const res = await POST(jsonReq('POST', {}), params())
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(jsonReq('POST', {}, VARIANT_ID), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(jsonReq('POST', {}, VARIANT_ID), params())
    expect(res.status).toBe(403)
  })

  it('returns 400 when max images per variant reached', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, variant_id: VARIANT_ID }))
    mockQueryOne.mockResolvedValueOnce({ variant_images: five } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }, VARIANT_ID), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Maximum/)
  })

  it('returns 400 on invalid JSON (application/json)', async () => {
    mockQueryOne.mockResolvedValueOnce({ variant_images: [] } as any)
    const res = await POST(jsonReq('POST', 'not-json', VARIANT_ID), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid JSON/)
  })

  it('returns 400 when gallery_image_id is not a UUID', async () => {
    mockQueryOne.mockResolvedValueOnce({ variant_images: [] } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: 'nope' }, VARIANT_ID), params())
    expect(res.status).toBe(400)
  })

  it('returns 404 when gallery image not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ variant_images: [] } as any) // getStage
      .mockResolvedValueOnce(null) // gallery image
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }, VARIANT_ID), params())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/Gallery image not found/)
  })

  it('returns 400 when gallery image has no usable URL', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ variant_images: [] } as any)
      .mockResolvedValueOnce({ id: 'g1', image_url: null, s3_key: null } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }, VARIANT_ID), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no usable URL/)
  })

  it('stages a gallery image (image_url present) as primary and saves', async () => {
    mockQueryOne.mockResolvedValueOnce({ variant_images: [] } as any).mockResolvedValueOnce({
      id: 'g1',
      image_url: 'https://cdn/img.jpg',
      thumbnail_url: 'https://cdn/t.jpg',
      s3_key: 'k',
      s3_thumbnail_key: 'tk',
      custom_name: 'nice.jpg',
      file_name: 'img.jpg',
      file_size: 100,
      mime_type: 'image/jpeg',
      width: 10,
      height: 20,
    } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }, VARIANT_ID), params())
    expect(res.status).toBe(200)
    const { image } = await res.json()
    expect(image.is_primary).toBe(true)
    expect(image.display_order).toBe(0)
    expect(image.image_url).toBe('https://cdn/img.jpg')
    expect(image.file_name).toBe('nice.jpg') // custom_name wins
    expect(image._fromGallery).toBe(true)
    expect(mockQuery).toHaveBeenCalled() // saveStage
  })

  it('builds gallery URL from s3_key when image_url absent; not primary when others exist', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ variant_images: [{ id: 'x', variant_id: VARIANT_ID }] } as any)
      .mockResolvedValueOnce({
        id: 'g2',
        image_url: null,
        thumbnail_url: null,
        s3_key: 'gallery/img2.jpg',
        s3_thumbnail_key: 'gallery/t2.jpg',
        custom_name: null,
        file_name: 'img2.jpg',
        file_size: 50,
        mime_type: 'image/png',
        width: 5,
        height: 6,
      } as any)
    const res = await POST(jsonReq('POST', { gallery_image_id: UUID1 }, VARIANT_ID), params())
    expect(res.status).toBe(200)
    const { image } = await res.json()
    expect(image.is_primary).toBe(false) // existing.length === 1
    expect(image.display_order).toBe(1)
    expect(image.image_url).toBe('https://cdn.example.com/gallery/img2.jpg')
    expect(image.thumbnail_url).toBe('https://cdn.example.com/gallery/t2.jpg')
    expect(image.file_name).toBe('img2.jpg')
  })

  it('returns 400 when no file provided in form-data', async () => {
    mockQueryOne.mockResolvedValueOnce({ variant_images: [] } as any)
    const res = await POST(formReq(new FormData(), VARIANT_ID), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/No file provided/)
  })

  it('uploads a file and stages it as a fresh upload', async () => {
    mockQueryOne.mockResolvedValueOnce({ variant_images: [] } as any)
    mockUpload.mockResolvedValue({
      url: 'https://cdn/u.jpg',
      thumbnailUrl: 'https://cdn/ut.jpg',
      s3Key: 's3k',
      s3ThumbnailKey: 's3tk',
      fileName: 'u.jpg',
      fileSize: 999,
      mimeType: 'image/jpeg',
      width: 100,
      height: 200,
    } as any)
    const form = new FormData()
    form.append('file', new File(['bytes'], 'u.jpg', { type: 'image/jpeg' }))
    const res = await POST(formReq(form, VARIANT_ID), params())
    expect(res.status).toBe(200)
    const { image } = await res.json()
    expect(image._staged).toBe(true)
    expect(image.is_primary).toBe(true)
    expect(image.image_url).toBe('https://cdn/u.jpg')
    expect(image.s3_key).toBe('s3k')
    expect(mockUpload).toHaveBeenCalledWith(expect.any(File), VARIANT_ID)
  })

  it('returns 500 when upload throws', async () => {
    mockQueryOne.mockResolvedValueOnce({ variant_images: [] } as any)
    mockUpload.mockRejectedValue(new Error('s3 down'))
    const form = new FormData()
    form.append('file', new File(['bytes'], 'u.jpg', { type: 'image/jpeg' }))
    const res = await POST(formReq(form, VARIANT_ID), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/s3 down/)
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('DELETE /api/admin/products/[id]/draft/variant-images', () => {
  it('returns 400 when variant_id missing', async () => {
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }), params())
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }, VARIANT_ID), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }, VARIANT_ID), params())
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await DELETE(jsonReq('DELETE', 'not-json', VARIANT_ID), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid JSON/)
  })

  it('returns 400 when imageId missing from body', async () => {
    const res = await DELETE(jsonReq('DELETE', {}, VARIANT_ID), params())
    expect(res.status).toBe(400)
  })

  it('removes a non-primary image without promoting', async () => {
    mockQueryOne.mockResolvedValueOnce({
      variant_images: [
        { id: 'i1', variant_id: VARIANT_ID, is_primary: true, display_order: 0 },
        { id: 'i2', variant_id: VARIANT_ID, is_primary: false, display_order: 1 },
      ],
    } as any)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i2' }, VARIANT_ID), params())
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved.map((v: any) => v.id)).toEqual(['i1'])
    expect(saved.find((v: any) => v.id === 'i1').is_primary).toBe(true)
  })

  it('promotes the first remaining image when the primary is deleted', async () => {
    mockQueryOne.mockResolvedValueOnce({
      variant_images: [
        { id: 'i1', variant_id: VARIANT_ID, is_primary: true, display_order: 0 },
        { id: 'i3', variant_id: VARIANT_ID, is_primary: false, display_order: 2 },
        { id: 'i2', variant_id: VARIANT_ID, is_primary: false, display_order: 1 },
      ],
    } as any)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }, VARIANT_ID), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    // i2 has the lowest display_order among survivors → promoted
    expect(saved.find((v: any) => v.id === 'i2').is_primary).toBe(true)
    expect(saved.find((v: any) => v.id === 'i3').is_primary).toBe(false)
  })

  it('deleting the primary with no survivors just removes it', async () => {
    mockQueryOne.mockResolvedValueOnce({
      variant_images: [{ id: 'i1', variant_id: VARIANT_ID, is_primary: true, display_order: 0 }],
    } as any)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }, VARIANT_ID), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved).toEqual([])
  })

  it('no-op when imageId does not match this variant', async () => {
    mockQueryOne.mockResolvedValueOnce({
      variant_images: [{ id: 'i1', variant_id: 'other-var', is_primary: true }],
    } as any)
    const res = await DELETE(jsonReq('DELETE', { imageId: 'i1' }, VARIANT_ID), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved.map((v: any) => v.id)).toEqual(['i1']) // untouched
  })
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/products/[id]/draft/variant-images', () => {
  it('returns 400 when variant_id missing', async () => {
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i1' }), params())
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i1' }, VARIANT_ID), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i1' }, VARIANT_ID), params())
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await PATCH(jsonReq('PATCH', 'not-json', VARIANT_ID), params())
    expect(res.status).toBe(400)
  })

  it('returns 400 when imageId missing', async () => {
    const res = await PATCH(jsonReq('PATCH', { isPrimary: true }, VARIANT_ID), params())
    expect(res.status).toBe(400)
  })

  it('setting isPrimary makes exactly the target primary within the variant', async () => {
    mockQueryOne.mockResolvedValueOnce({
      variant_images: [
        { id: 'i1', variant_id: VARIANT_ID, is_primary: true },
        { id: 'i2', variant_id: VARIANT_ID, is_primary: false },
        { id: 'o1', variant_id: 'other', is_primary: true },
      ],
    } as any)
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i2', isPrimary: true }, VARIANT_ID), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved.find((v: any) => v.id === 'i2').is_primary).toBe(true)
    expect(saved.find((v: any) => v.id === 'i1').is_primary).toBe(false)
    expect(saved.find((v: any) => v.id === 'o1').is_primary).toBe(true) // other variant untouched
  })

  it('updates display_order for the matching image only', async () => {
    mockQueryOne.mockResolvedValueOnce({
      variant_images: [
        { id: 'i1', variant_id: VARIANT_ID, display_order: 0 },
        { id: 'i2', variant_id: VARIANT_ID, display_order: 1 },
      ],
    } as any)
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i2', displayOrder: 5 }, VARIANT_ID), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved.find((v: any) => v.id === 'i2').display_order).toBe(5)
    expect(saved.find((v: any) => v.id === 'i1').display_order).toBe(0)
  })

  it('no isPrimary and no displayOrder leaves rows unchanged', async () => {
    mockQueryOne.mockResolvedValueOnce({
      variant_images: [{ id: 'i1', variant_id: VARIANT_ID, display_order: 0, is_primary: true }],
    } as any)
    const res = await PATCH(jsonReq('PATCH', { imageId: 'i1' }, VARIANT_ID), params())
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockQuery.mock.calls[0][1]![1] as string)
    expect(saved[0]).toMatchObject({ id: 'i1', display_order: 0, is_primary: true })
  })
})
