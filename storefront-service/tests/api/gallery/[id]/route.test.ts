import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/s3', () => ({ deleteGalleryImage: vi.fn() }))

import { DELETE } from '@storefront/app/api/(public)/gallery/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { deleteGalleryImage } from '@/lib/shared/s3'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockDelete = vi.mocked(deleteGalleryImage)

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['products:write'] }
const params = { params: Promise.resolve({ id: 'img1' }) }
const makeRequest = () => new NextRequest('http://localhost/api/gallery/img1', { method: 'DELETE' })

describe('DELETE /api/gallery/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN)
    mockHasScope.mockReturnValue(true)
  })

  it('401 when not an admin', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(makeRequest(), params)
    expect(res.status).toBe(401)
  })

  it('403 without any gallery write scope', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeRequest(), params)
    expect(res.status).toBe(403)
    for (const s of ['products:write', 'settings:write', 'coupons:write', 'social:write']) {
      expect(mockHasScope).toHaveBeenCalledWith('admin', ['products:write'], s)
    }
    expect(mockQueryOne).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('any one of the editor scopes is enough', async () => {
    mockHasScope.mockImplementation((_r, _s, scope) => scope === 'social:write')
    mockQueryOne.mockResolvedValue(null)
    const res = await DELETE(makeRequest(), params)
    expect(res.status).toBe(404)
  })

  it('404 when the image does not exist', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await DELETE(makeRequest(), params)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Not found')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('deletes the S3 objects and the row', async () => {
    mockQueryOne.mockResolvedValue({ id: 'img1', s3_key: 'gallery/img1.jpg', s3_thumbnail_key: 'gallery/thumb_img1.jpg' })
    mockDelete.mockResolvedValue(undefined as any)
    mockQuery.mockResolvedValue(undefined as any)
    const res = await DELETE(makeRequest(), params)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('FROM gallery_images'), ['img1'])
    expect(mockDelete).toHaveBeenCalledWith('gallery/img1.jpg', 'gallery/thumb_img1.jpg')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM gallery_images'), ['img1'])
  })

  it('passes null S3 keys through when the row has none', async () => {
    mockQueryOne.mockResolvedValue({ id: 'img1', s3_key: null, s3_thumbnail_key: null })
    mockDelete.mockResolvedValue(undefined as any)
    mockQuery.mockResolvedValue(undefined as any)
    await DELETE(makeRequest(), params)
    expect(mockDelete).toHaveBeenCalledWith(null, null)
  })
})
