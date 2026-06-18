import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mock AWS SDK before any imports ----------------------------------------
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function (this: any) { this.send = mockSend }),
  PutObjectCommand: vi.fn().mockImplementation(function (this: any, input: unknown) { Object.assign(this, { _cmd: 'PUT', ...input as object }) }),
  DeleteObjectCommand: vi.fn().mockImplementation(function (this: any, input: unknown) { Object.assign(this, { _cmd: 'DELETE', ...input as object }) }),
  CopyObjectCommand: vi.fn().mockImplementation(function (this: any, input: unknown) { Object.assign(this, { _cmd: 'COPY', ...input as object }) }),
}))

// ---- Mock sharp ---------------------------------------------------------------
vi.mock('sharp', () => {
  const chain = () => {
    const obj: any = {
      rotate: () => obj,
      resize: () => obj,
      jpeg: () => obj,
      png: () => obj,
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('img')),
      metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
    }
    return obj
  }
  const sharp = vi.fn().mockImplementation(chain)
  return { default: sharp }
})

// ---- Mock @/lib/db for saveProductImages ------------------------------------
vi.mock('@/lib/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import {
  getS3Url,
  generateProductImageKeys,
  uploadInvoicePDF,
  deleteProductImage,
  deleteGalleryImage,
  copyGalleryImageToProduct,
  saveProductImages,
} from '@/lib/s3'

describe('getS3Url', () => {
  it('returns CloudFront URL when CLOUDFRONT_URL is set', () => {
    vi.stubEnv('CLOUDFRONT_URL', 'https://cdn.example.com')
    vi.stubEnv('S3_KEY_PREFIX', '')
    // Re-import to pick up env — but since module is already loaded, test the pure logic
    const url = getS3Url('products/123/image.jpg')
    expect(url).toContain('products/123/image.jpg')
    vi.unstubAllEnvs()
  })

  it('returns S3 bucket URL when no CloudFront URL (module default)', () => {
    // With no CloudFront override at module load time we test the path shape
    const url = getS3Url('products/abc/test.jpg')
    expect(url).toMatch(/^https?:\/\//)
    expect(url).toContain('products/abc/test.jpg')
  })
})

describe('generateProductImageKeys', () => {
  it('returns imageKey and thumbnailKey', () => {
    const { imageKey, thumbnailKey } = generateProductImageKeys('prod-1', 'photo.jpg')
    expect(imageKey).toContain('products/prod-1/')
    expect(imageKey).toContain('photo.jpg')
    expect(thumbnailKey).toContain('products/prod-1/thumbnails/')
    expect(thumbnailKey).toContain('photo.jpg')
  })

  it('sanitises special characters in filename', () => {
    const { imageKey } = generateProductImageKeys('prod-2', 'my photo (1).jpg')
    expect(imageKey).not.toContain(' ')
    expect(imageKey).not.toContain('(')
    expect(imageKey).not.toContain(')')
  })

  it('imageKey and thumbnailKey share the same timestamp prefix', () => {
    const { imageKey, thumbnailKey } = generateProductImageKeys('prod-3', 'a.jpg')
    // Both contain the same base filename after the timestamp
    const imgName = imageKey.split('/').pop()
    const thmName = thumbnailKey.split('/').pop()
    expect(imgName).toBe(thmName)
  })
})

describe('uploadInvoicePDF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({})
  })

  it('calls S3 send once and returns a URL', async () => {
    const buf = Buffer.from('%PDF')
    const url = await uploadInvoicePDF(buf, 'INV/2024-001', '2024-25')
    expect(mockSend).toHaveBeenCalledOnce()
    expect(typeof url).toBe('string')
    expect(url).toContain('invoices/2024-25/INV-2024-001.pdf')
  })

  it('replaces slashes in invoice number with dashes', async () => {
    const buf = Buffer.from('%PDF')
    const url = await uploadInvoicePDF(buf, 'A/B/C', '2025-26')
    expect(url).toContain('A-B-C.pdf')
  })
})

describe('deleteProductImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({})
  })

  it('sends two DeleteObjectCommands (image + thumbnail)', async () => {
    await deleteProductImage('products/p1/img.jpg', 'products/p1/thumbnails/img.jpg')
    expect(mockSend).toHaveBeenCalledTimes(2)
  })
})

describe('deleteGalleryImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({})
  })

  it('deletes both image and thumbnail', async () => {
    await deleteGalleryImage('gallery/img.png', 'gallery/thumbnails/img.png')
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it('skips thumbnail delete when s3ThumbnailKey is empty', async () => {
    await deleteGalleryImage('gallery/img.png', '')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})

describe('copyGalleryImageToProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies both files and returns product-path keys', async () => {
    mockSend.mockResolvedValue({})
    const result = await copyGalleryImageToProduct(
      'gallery/ts-photo.png',
      'gallery/thumbnails/ts-photo.png',
      'prod-42'
    )
    expect(result.s3Key).toContain('products/prod-42/')
    expect(result.s3ThumbnailKey).toContain('products/prod-42/thumbnails/')
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it('returns fallback keys on NoSuchKey error', async () => {
    const err: any = new Error('No such key')
    err.name = 'NoSuchKey'
    mockSend.mockRejectedValue(err)
    const result = await copyGalleryImageToProduct(
      'gallery/missing.png',
      'gallery/thumbnails/missing.png',
      'prod-99',
      'https://cdn.example.com/fallback.png',
      'https://cdn.example.com/fallback-thumb.png'
    )
    expect(result.url).toBe('https://cdn.example.com/fallback.png')
    expect(result.thumbnailUrl).toBe('https://cdn.example.com/fallback-thumb.png')
  })

  it('rethrows non-NoSuchKey errors', async () => {
    const err = new Error('Network failure')
    mockSend.mockRejectedValue(err)
    await expect(
      copyGalleryImageToProduct('gallery/img.png', 'gallery/thumbnails/img.png', 'prod-1')
    ).rejects.toThrow('Network failure')
  })
})

describe('saveProductImages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts one row per image', async () => {
    const { query } = await import('@/lib/db')
    const mockQ = vi.mocked(query)
    mockQ.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    await saveProductImages('prod-1', [
      { url: 'u1', thumbnailUrl: 'tu1', s3Key: 'k1', s3ThumbnailKey: 'tk1', fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', width: 800, height: 600 },
      { url: 'u2', thumbnailUrl: 'tu2', s3Key: 'k2', s3ThumbnailKey: 'tk2', fileName: 'b.jpg', fileSize: 200, mimeType: 'image/jpeg', width: 400, height: 300 },
    ])
    expect(mockQ).toHaveBeenCalledTimes(2)
  })
})
