import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
  authenticateAnyUser: vi.fn(),
  authenticateUser: vi.fn(),
  verifyToken: vi.fn(),
}))
vi.mock('@/lib/shared/s3', () => ({
  deleteGalleryImage: vi.fn(),
  uploadGalleryImage: vi.fn(),
}))

import { DELETE } from '@/app/api/(public)/gallery/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryOne, query } from '@/lib/shared/db'
import { deleteGalleryImage } from '@/lib/shared/s3'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockDelete = vi.mocked(deleteGalleryImage)

const params = { params: Promise.resolve({ id: 'img1' }) }

function makeRequest() {
  return new Request('http://localhost/api/gallery/img1', { method: 'DELETE' })
}

describe('DELETE /api/gallery/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not admin', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await DELETE(makeRequest() as any, params as any)
    expect(res.status).toBe(401)
  })

  it('returns 404 when record not found', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await DELETE(makeRequest() as any, params as any)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Not found')
  })

  it('deletes s3 files and db record on success', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockQueryOne.mockResolvedValueOnce({
      id: 'img1',
      s3_key: 'gallery/img1.jpg',
      s3_thumbnail_key: 'gallery/thumb_img1.jpg',
    })
    mockDelete.mockResolvedValueOnce(undefined as any)
    mockQuery.mockResolvedValueOnce(undefined as any)

    const res = await DELETE(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(mockDelete).toHaveBeenCalledWith('gallery/img1.jpg', 'gallery/thumb_img1.jpg')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM gallery_images'), ['img1'])
  })

  it('passes null s3 keys to deleteGalleryImage when missing', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockQueryOne.mockResolvedValueOnce({
      id: 'img1',
      s3_key: null,
      s3_thumbnail_key: null,
    })
    mockDelete.mockResolvedValueOnce(undefined as any)
    mockQuery.mockResolvedValueOnce(undefined as any)

    await DELETE(makeRequest() as any, params as any)
    expect(mockDelete).toHaveBeenCalledWith(null, null)
  })
})
