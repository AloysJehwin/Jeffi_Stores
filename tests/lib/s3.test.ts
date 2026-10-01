import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSend } = vi.hoisted(() => {
  const mockSend = vi.fn().mockResolvedValue({})
  return { mockSend }
})

vi.mock('@aws-sdk/client-s3', () => {
  const S3Client = vi.fn().mockImplementation(function () {
    return { send: mockSend }
  })
  const PutObjectCommand = vi.fn().mockImplementation(function (input: unknown) {
    return { input, _t: 'Put' }
  })
  const DeleteObjectCommand = vi.fn().mockImplementation(function (input: unknown) {
    return { input, _t: 'Delete' }
  })
  const CopyObjectCommand = vi.fn().mockImplementation(function (input: unknown) {
    return { input, _t: 'Copy' }
  })
  const HeadObjectCommand = vi.fn().mockImplementation(function (input: unknown) {
    return { input, _t: 'Head' }
  })
  return { S3Client, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand }
})

vi.mock('sharp', () => {
  const instance = {
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumb')),
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  }
  return { default: vi.fn().mockReturnValue(instance) }
})

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

import {
  getS3Url,
  generateProductImageKeys,
  uploadProductImage,
  uploadInvoicePDF,
  deleteProductImage,
  saveProductImages,
  uploadGalleryImage,
  copyGalleryImageToProduct,
  uploadVariantImage,
  uploadReviewImage,
  uploadAvatarImage,
  deleteGalleryImage,
} from '@/lib/shared/s3'
import { DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { query } from '@/lib/shared/db'

function makeFile(type = 'image/jpeg', size = 1024): File {
  const buf = Buffer.alloc(size)
  return new File([buf], 'test.jpg', { type })
}

describe('getS3Url', () => {
  it('returns S3 URL when no CLOUDFRONT_URL', async () => {
    const url = await getS3Url('products/p1/img.jpg')
    expect(url).toContain('s3.')
    expect(url).toContain('img.jpg')
  })

  it('includes the canonical key in the URL', async () => {
    const url = await getS3Url('test/key.png')
    expect(url).toContain('test/key.png')
  })
})

describe('generateProductImageKeys', () => {
  it('sanitizes special characters in filename', () => {
    const keys = generateProductImageKeys('prod-1', 'my file (1).jpg')
    expect(keys.imageKey).toMatch(/products\/prod-1\/\d+-my_file__1_.jpg/)
    expect(keys.thumbnailKey).toContain('thumbnails')
  })

  it('preserves alphanumeric and dots in filename', () => {
    const keys = generateProductImageKeys('prod-2', 'image.jpg')
    expect(keys.imageKey).toContain('image.jpg')
  })
})

describe('uploadProductImage', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue({})
  })

  it('throws on invalid file type', async () => {
    const file = makeFile('application/pdf')
    await expect(uploadProductImage(file, 'prod-1')).rejects.toThrow('Invalid file type')
  })

  it('throws when file exceeds 5MB', async () => {
    const file = makeFile('image/jpeg', 6 * 1024 * 1024)
    await expect(uploadProductImage(file, 'prod-1')).rejects.toThrow('File size exceeds 5MB')
  })

  it('uploads successfully for valid jpeg', async () => {
    const file = makeFile('image/jpeg', 1024)
    const result = await uploadProductImage(file, 'prod-1')
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.s3Key).toContain('products/prod-1/')
    expect(result.s3ThumbnailKey).toContain('thumbnails')
  })

  it('uploads successfully for image/png', async () => {
    const file = makeFile('image/png', 1024)
    const result = await uploadProductImage(file, 'prod-1')
    expect(result.mimeType).toBe('image/png')
  })

  it('uploads successfully for image/webp', async () => {
    const file = makeFile('image/webp', 1024)
    const result = await uploadProductImage(file, 'prod-1')
    expect(result.mimeType).toBe('image/webp')
  })
})

describe('uploadInvoicePDF', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue({})
  })

  it('uploads PDF and returns URL', async () => {
    const buf = Buffer.from('pdf content')
    const url = await uploadInvoicePDF(buf, 'INV/2024/001', '2024-25')
    expect(url).toContain('INV-2024-001.pdf')
  })
})

describe('deleteProductImage', () => {
  beforeEach(() => {
    vi.mocked(DeleteObjectCommand).mockClear()
    mockSend.mockResolvedValue({})
  })

  it('deletes both image and thumbnail', async () => {
    await deleteProductImage('products/p1/img.jpg', 'products/p1/thumbnails/img.jpg')
    expect(vi.mocked(DeleteObjectCommand)).toHaveBeenCalledTimes(2)
  })
})

describe('saveProductImages', () => {
  beforeEach(() => vi.mocked(query).mockClear())

  it('does nothing for empty images array', async () => {
    await saveProductImages('prod-1', [])
    expect(vi.mocked(query)).not.toHaveBeenCalled()
  })

  it('inserts each image and sets isPrimary for first image', async () => {
    const images = [
      {
        url: 'u1',
        thumbnailUrl: 't1',
        s3Key: 'k1',
        s3ThumbnailKey: 'tk1',
        fileName: 'f1.jpg',
        fileSize: 100,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
      },
      {
        url: 'u2',
        thumbnailUrl: 't2',
        s3Key: 'k2',
        s3ThumbnailKey: 'tk2',
        fileName: 'f2.jpg',
        fileSize: 200,
        mimeType: 'image/jpeg',
        width: 400,
        height: 300,
        altText: 'Alt text',
        isPrimary: false,
      },
    ]
    await saveProductImages('prod-1', images)
    expect(vi.mocked(query)).toHaveBeenCalledTimes(2)
    // Column order: ... width(9), height(10), blurhash(11), alt_text(12), display_order(13), is_primary(14)
    // First image: no blurhash supplied -> null; altText defaults to '', isPrimary = true (i === 0)
    const firstCall = vi.mocked(query).mock.calls[0][1] as any[]
    expect(firstCall[11]).toBe(null) // blurhash default
    expect(firstCall[12]).toBe('') // altText default
    expect(firstCall[14]).toBe(true) // isPrimary = i === 0
    // Second image: altText = 'Alt text', isPrimary = false (explicit)
    const secondCall = vi.mocked(query).mock.calls[1][1] as any[]
    expect(secondCall[12]).toBe('Alt text')
    expect(secondCall[14]).toBe(false)
  })
})

describe('uploadGalleryImage', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue({})
  })

  it('returns gallery upload result', async () => {
    const buf = Buffer.from('img data')
    const result = await uploadGalleryImage(buf, 'my image!.png')
    expect(result.s3Key).toContain('gallery/')
    expect(result.s3ThumbnailKey).toContain('gallery/thumbnails/')
    expect(result.fileName).toContain('.png')
  })

  it('returns 0 for width when metadata.width is falsy', async () => {
    const sharp = ((await import('sharp')) as any).default
    const instance = {
      rotate: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      png: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumb')),
      metadata: vi.fn().mockResolvedValue({ width: 0, height: 0 }),
    }
    sharp.mockReturnValueOnce(instance).mockReturnValueOnce(instance)
    const buf = Buffer.from('img data')
    const result = await uploadGalleryImage(buf, 'zero-dim.jpg')
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
  })
})

describe('copyGalleryImageToProduct', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue({}) // Head + Copy both succeed by default (source exists)
  })

  it('copies gallery image to a product-owned key (never a gallery key)', async () => {
    const result = await copyGalleryImageToProduct('gallery/123-img.png', 'gallery/thumbnails/123-img.png', 'prod-1')
    expect(result.s3Key).toContain('products/prod-1/')
    expect(result.s3ThumbnailKey).toContain('products/prod-1/thumbnails/')
    expect(result.s3Key).not.toContain('gallery/')
    expect(result.url).toContain('products/prod-1/')
  })

  it('THROWS when the gallery source is missing — never falls back to a gallery key', async () => {
    // Every HeadObject rejects → source resolves to null → must throw.
    mockSend.mockRejectedValue(Object.assign(new Error('Not Found'), { name: 'NotFound' }))
    await expect(
      copyGalleryImageToProduct('gallery/missing.png', 'gallery/thumbnails/missing.png', 'prod-1')
    ).rejects.toThrow(/not found on S3/i)
  })

  it('reuses the full image as thumbnail when the gallery thumb is missing (still product-owned)', async () => {
    // First Head (full) succeeds, Copy succeeds; thumb Head(s) reject.
    mockSend
      .mockResolvedValueOnce({}) // Head full → exists
      .mockResolvedValueOnce({}) // Copy full
      .mockRejectedValue(Object.assign(new Error('Not Found'), { name: 'NotFound' })) // thumb Heads fail
    const result = await copyGalleryImageToProduct('gallery/img.png', 'gallery/thumbnails/img.png', 'prod-1')
    expect(result.s3Key).toContain('products/prod-1/')
    // thumbnail falls back to the full product key, NOT the gallery key
    expect(result.s3ThumbnailKey).toBe(result.s3Key)
    expect(result.thumbnailUrl).not.toContain('gallery/')
  })
})

describe('uploadVariantImage', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue({})
  })

  it('throws on invalid file type', async () => {
    const file = makeFile('video/mp4')
    await expect(uploadVariantImage(file, 'var-1')).rejects.toThrow('Invalid file type')
  })

  it('throws when file exceeds 5MB', async () => {
    const file = makeFile('image/jpeg', 6 * 1024 * 1024)
    await expect(uploadVariantImage(file, 'var-1')).rejects.toThrow('File size exceeds 5MB')
  })

  it('uploads successfully', async () => {
    const file = makeFile('image/jpeg', 1024)
    const result = await uploadVariantImage(file, 'var-1')
    expect(result.s3Key).toContain('products/variants/var-1/')
  })
})

describe('uploadReviewImage', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue({})
  })

  it('throws on invalid file type', async () => {
    const file = makeFile('application/pdf')
    await expect(uploadReviewImage(file, 'rev-1')).rejects.toThrow('Invalid file type')
  })

  it('throws when file exceeds 5MB', async () => {
    const file = makeFile('image/png', 6 * 1024 * 1024)
    await expect(uploadReviewImage(file, 'rev-1')).rejects.toThrow('File size exceeds 5MB')
  })

  it('uploads successfully', async () => {
    const file = makeFile('image/png', 1024)
    const result = await uploadReviewImage(file, 'rev-1')
    expect(result.url).toContain('reviews/rev-1/')
    expect(result.thumbnailUrl).toContain('reviews/rev-1/thumbnails/')
  })
})

describe('uploadAvatarImage', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue({})
  })

  it('uploads avatar and returns url and s3Key', async () => {
    const buf = Buffer.from('avatar data')
    const result = await uploadAvatarImage(buf, 'user-1')
    expect(result.s3Key).toBe('avatars/user-1.jpg')
    expect(result.url).toContain('user-1.jpg')
  })
})

describe('deleteGalleryImage', () => {
  beforeEach(() => {
    vi.mocked(DeleteObjectCommand).mockClear()
    mockSend.mockResolvedValue({})
  })

  it('deletes both main and thumbnail when thumbnailKey provided', async () => {
    await deleteGalleryImage('gallery/img.png', 'gallery/thumbnails/img.png')
    expect(vi.mocked(DeleteObjectCommand)).toHaveBeenCalledTimes(2)
  })

  it('only deletes main image when thumbnailKey is empty string', async () => {
    await deleteGalleryImage('gallery/img.png', '')
    expect(vi.mocked(DeleteObjectCommand)).toHaveBeenCalledTimes(1)
  })
})
