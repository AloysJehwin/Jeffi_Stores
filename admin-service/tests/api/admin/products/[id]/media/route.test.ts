import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/catalog/product-media', () => ({ getMediaLimits: vi.fn() }))
vi.mock('@/lib/shared/s3', () => {
  class UploadValidationError extends Error {}
  return {
    UploadValidationError,
    copyGalleryImageToProduct: vi.fn(),
    deleteObjectKey: vi.fn(() => Promise.resolve()),
    getS3Url: vi.fn(),
    inspectObject: vi.fn(),
    presignProductMediaUpload: vi.fn(),
    PRODUCT_MEDIA_KEY_RE: /^products\/[^/]+\/[\w.-]+\.(pdf|glb|usdz|mp3|m4a|ogg)$/,
    PRODUCT_MEDIA_TYPES: { 'application/pdf': 'pdf', 'audio/mpeg': 'mp3', 'model/gltf-binary': 'glb', 'image/png': 'png' } as Record<string, string>,
    uploadProductImage: vi.fn(),
  }
})

import { POST } from '@admin/app/api/(admin)/admin/products/[id]/media/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { getMediaLimits } from '@/lib/catalog/product-media'
import * as s3 from '@/lib/shared/s3'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const json = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx)
const upload = (size = 4) => {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array(size)], 'a.png', { type: 'image/png' }))
  return POST(new NextRequest('http://localhost/x', { method: 'POST', body: fd }), ctx)
}
const UUID = '11111111-1111-4111-8111-111111111111'

describe('POST /api/admin/products/[id]/media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queryOne).mockReset()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ '?column?': 1 })
    vi.mocked(getMediaLimits).mockResolvedValue({ imageMb: 1, documentMb: 1, audioMb: 1, modelMb: 1 } as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns 401, 403 and 404', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await json({})).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await json({})).status).toBe(403)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await json({})).status).toBe(404)
  })

  it('returns 413 for an oversized image and uploads a valid one', async () => {
    expect((await upload(1024 * 1024 + 1)).status).toBe(413)
    vi.mocked(s3.uploadProductImage).mockResolvedValue({
      url: 'u', thumbnailUrl: 't', s3Key: 'k', s3ThumbnailKey: 'tk', fileName: 'a.png', mimeType: 'image/png', fileSize: 4, width: 0, height: 0, blurhash: 'bh',
    } as never)
    const body = await (await upload()).json()
    expect(body.item).toMatchObject({ url: 'u', s3_key: 'k', width: null, metadata: { blurhash: 'bh' } })
    expect(vi.mocked(s3.uploadProductImage).mock.calls[0][1]).toBe('p1')
  })

  it('maps upload validation errors to 400 and others to 500', async () => {
    vi.mocked(s3.uploadProductImage).mockRejectedValueOnce(new s3.UploadValidationError('not an image'))
    expect((await upload()).status).toBe(400)
    vi.mocked(s3.uploadProductImage).mockRejectedValueOnce(new Error('s3'))
    expect((await upload()).status).toBe(500)
  })

  it('copies a gallery image into the product, 404 when unknown', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ x: 1 }).mockResolvedValueOnce(null)
    expect((await json({ gallery_image_id: UUID })).status).toBe(404)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ x: 1 })
      .mockResolvedValueOnce({ s3_key: 'g', s3_thumbnail_key: 'gt', file_name: 'f.png', custom_name: 'Custom', blurhash: 'b' })
    vi.mocked(s3.copyGalleryImageToProduct).mockResolvedValue({ url: 'u', thumbnailUrl: 't', s3Key: 'k', s3ThumbnailKey: 'tk', mimeType: 'image/png' } as never)
    const body = await (await json({ gallery_image_id: UUID })).json()
    expect(body.item).toMatchObject({ s3_key: 'k', file_name: 'Custom', metadata: { blurhash: 'b' } })
    expect(s3.copyGalleryImageToProduct).toHaveBeenCalledWith('g', 'gt', 'p1')
  })

  it('presigns an allowed type and rejects disallowed or oversized ones', async () => {
    vi.mocked(s3.presignProductMediaUpload).mockResolvedValue({ uploadUrl: 'https://u', key: 'products/p1/a.pdf' } as never)
    const ok = await json({ action: 'presign', kind: 'document', mimeType: 'application/pdf', size: 100 })
    expect(await ok.json()).toEqual({ uploadUrl: 'https://u', key: 'products/p1/a.pdf' })
    expect(s3.presignProductMediaUpload).toHaveBeenCalledWith('p1', 'application/pdf', 100)
    expect((await json({ action: 'presign', kind: 'audio', mimeType: 'application/pdf', size: 1 })).status).toBe(400)
    expect((await json({ action: 'presign', kind: 'document', mimeType: 'application/pdf', size: 2 * 1024 * 1024 })).status).toBe(413)
  })

  it('confirms an upload after checking its magic bytes', async () => {
    vi.mocked(s3.inspectObject).mockResolvedValue({ head: Buffer.from('%PDF-1.7'), size: 99 } as never)
    vi.mocked(s3.getS3Url).mockResolvedValue('https://cdn/a.pdf' as never)
    const res = await json({ action: 'confirm', key: 'products/p1/a.pdf' })
    expect(await res.json()).toEqual({ url: 'https://cdn/a.pdf', key: 'products/p1/a.pdf', size: 99 })
  })

  it('deletes and rejects an upload with the wrong content', async () => {
    vi.mocked(s3.inspectObject).mockResolvedValue({ head: Buffer.from('<html>'), size: 6 } as never)
    const res = await json({ action: 'confirm', key: 'products/p1/a.pdf' })
    expect(res.status).toBe(400)
    expect(s3.deleteObjectKey).toHaveBeenCalledWith('products/p1/a.pdf')
  })

  it('rejects a key outside this product, a missing upload, and unknown bodies', async () => {
    expect((await json({ action: 'confirm', key: 'products/other/a.pdf' })).status).toBe(400)
    vi.mocked(s3.inspectObject).mockResolvedValue(null as never)
    expect((await json({ action: 'confirm', key: 'products/p1/a.pdf' })).status).toBe(400)
    expect((await json({ nothing: true })).status).toBe(400)
  })
})
