import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { authenticateAdminMock } = vi.hoisted(() => ({ authenticateAdminMock: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/jwt', async () => {
  const { NextResponse } = await import('next/server')
  const { hasScope } = await vi.importActual<typeof import('@/lib/scopes')>('@/lib/scopes')
  return {
    authenticateAdmin: authenticateAdminMock,
    verifyToken: vi.fn().mockResolvedValue(null),
    requireAdminScope: async (_req: unknown, scope: string | null) => {
      const admin = await authenticateAdminMock()
      if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (scope && !hasScope(admin.role, admin.scopes, scope)) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }
      return admin
    },
  }
})

vi.mock('@/lib/s3', () => ({
  uploadProductImage: vi.fn().mockResolvedValue({
    url: 'https://cdn.example.com/img.jpg',
    thumbnailUrl: 'https://cdn.example.com/img-thumb.jpg',
    s3Bucket: 'jeffi-stores-bucket',
    s3Key: 'products/img.jpg',
    s3ThumbnailKey: 'products/img-thumb.jpg',
    fileName: 'img.jpg',
    fileSize: 1024,
    mimeType: 'image/jpeg',
    width: 800,
    height: 600,
  }),
}))

// ---------------------------------------------------------------------------

import { POST } from '@/app/api/upload/route'
import { authenticateAdmin } from '@/lib/jwt'
import { uploadProductImage } from '@/lib/s3'

const mockAuthenticateAdmin = vi.mocked(authenticateAdmin)
const mockUploadProductImage = vi.mocked(uploadProductImage)

const VALID_ADMIN = {
  adminId: 'admin-001',
  username: 'alice',
  role: 'super_admin',
  scopes: ['products:write'],
}

function makeUploadRequest(fields: Record<string, string | File>): Request {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v)
  }
  return new Request('http://localhost/api/upload', { method: 'POST', body: form })
}

beforeEach(() => {
  mockAuthenticateAdmin.mockResolvedValue(VALID_ADMIN as any)
  mockUploadProductImage.mockResolvedValue({
    url: 'https://cdn.example.com/img.jpg',
    blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    thumbnailUrl: 'https://cdn.example.com/img-thumb.jpg',
    s3Bucket: 'jeffi-stores-bucket',
    s3Key: 'products/img.jpg',
    s3ThumbnailKey: 'products/img-thumb.jpg',
    fileName: 'img.jpg',
    fileSize: 1024,
    mimeType: 'image/jpeg',
    width: 800,
    height: 600,
  })
})

describe('POST /api/upload', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuthenticateAdmin.mockResolvedValueOnce(null)
    const req = makeUploadRequest({
      productId: 'prod-1',
      file: new File(['data'], 'photo.jpg', { type: 'image/jpeg' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when the admin lacks products:write', async () => {
    mockAuthenticateAdmin.mockResolvedValueOnce({ ...VALID_ADMIN, role: 'viewer', scopes: ['products:read'] } as any)
    const req = makeUploadRequest({
      productId: 'prod-1',
      file: new File(['data'], 'photo.jpg', { type: 'image/jpeg' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })

  it('returns 400 when file is missing', async () => {
    const req = makeUploadRequest({ productId: 'prod-1' })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/file/i)
  })

  it('returns 400 when productId is missing', async () => {
    const req = makeUploadRequest({
      file: new File(['data'], 'photo.jpg', { type: 'image/jpeg' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/product/i)
  })

  it('uploads file and returns URL on success', async () => {
    const req = makeUploadRequest({
      productId: 'prod-abc',
      file: new File(['binary-image-data'], 'photo.jpg', { type: 'image/jpeg' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://cdn.example.com/img.jpg')
    expect(mockUploadProductImage).toHaveBeenCalledWith(expect.any(File), 'prod-abc')
  })

  it('returns 500 when S3 upload throws', async () => {
    mockUploadProductImage.mockRejectedValueOnce(new Error('S3 unavailable'))
    const req = makeUploadRequest({
      productId: 'prod-xyz',
      file: new File(['data'], 'photo.jpg', { type: 'image/jpeg' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/S3 unavailable/)
  })
})
