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

import { GET } from '@/app/api/gallery/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

function makeRequest(params: Record<string, string> = {}) {
  const search = new URLSearchParams(params).toString()
  const url = `http://localhost/api/gallery${search ? `?${search}` : ''}`
  return new Request(url)
}

describe('GET /api/gallery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CLOUDFRONT_URL = 'https://cdn.example.com'
  })

  it('returns 401 when not admin', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns paginated images', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockQueryMany.mockResolvedValueOnce([
      {
        id: 'img1',
        s3_key: 'gallery/img1.jpg',
        image_url: null,
        s3_thumbnail_key: null,
        thumbnail_url: null,
        category_name: 'Cat',
      },
    ])
    mockQueryOne.mockResolvedValueOnce({ total: '1' })

    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.images).toHaveLength(1)
    // The URL is built by getS3Url(s3_key), which prepends the env's S3_KEY_PREFIX.
    // The important assertion is that the s3_key drives the URL (prefix-consistent).
    expect(json.images[0].image_url).toContain('gallery/img1.jpg')
    expect(json.total).toBe(1)
    expect(json.page).toBe(1)
  })

  it('filters by category', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockQueryMany.mockResolvedValueOnce([])
    mockQueryOne.mockResolvedValueOnce({ total: '0' })

    const res = await GET(makeRequest({ category: 'cat1' }) as any)
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.stringContaining('gi.category_id'),
      expect.arrayContaining(['cat1'])
    )
  })

  it('filters by search across name + filename', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockQueryMany.mockResolvedValueOnce([])
    mockQueryOne.mockResolvedValueOnce({ total: '0' })

    const res = await GET(makeRequest({ search: 'bolt' }) as any)
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), expect.arrayContaining(['%bolt%']))
  })

  it('composes category + search filters', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockQueryMany.mockResolvedValueOnce([])
    mockQueryOne.mockResolvedValueOnce({ total: '0' })

    const res = await GET(makeRequest({ category: 'cat1', search: 'bolt' }) as any)
    expect(res.status).toBe(200)
    const [sql, params] = mockQueryMany.mock.calls[0]
    expect(sql).toContain('gi.category_id')
    expect(sql).toContain('ILIKE')
    expect(params).toContain('cat1')
    expect(params).toContain('%bolt%')
  })

  it('uses fallback image_url when s3_key is null', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockQueryMany.mockResolvedValueOnce([
      { id: 'img1', s3_key: null, image_url: 'https://old-url/img.jpg', s3_thumbnail_key: null, thumbnail_url: null },
    ])
    mockQueryOne.mockResolvedValueOnce({ total: '1' })

    const res = await GET(makeRequest() as any)
    const json = await res.json()
    expect(json.images[0].image_url).toBe('https://old-url/img.jpg')
  })

  it('respects pagination params', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1' } as any)
    mockQueryMany.mockResolvedValueOnce([])
    mockQueryOne.mockResolvedValueOnce({ total: '0' })

    const res = await GET(makeRequest({ page: '3', limit: '50' }) as any)
    const json = await res.json()
    expect(json.page).toBe(3)
    expect(json.limit).toBe(50)
  })
})
