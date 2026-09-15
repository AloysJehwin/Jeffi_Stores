import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockClientQuery = vi.fn()
vi.mock('@/lib/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  withTransaction: (fn: any) => fn({ query: (...a: any[]) => mockClientQuery(...a) }),
}))

import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { GET, POST, PATCH } from '@/app/api/admin/hero-slides/route'

const admin = { id: 'a1', role: 'super_admin', scopes: [] }

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/hero-slides', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}
function badReq(method: string) {
  return new NextRequest('http://localhost/api/admin/hero-slides', {
    method,
    body: 'not-json{',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET /api/admin/hero-slides', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(req('GET'))
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(req('GET'))
    expect(res.status).toBe(403)
  })

  it('returns slides', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 's1' }])
    const res = await GET(req('GET'))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.slides).toEqual([{ id: 's1' }])
  })
})

describe('POST /api/admin/hero-slides', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(req('POST', { title: 'Hi' }))
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(req('POST', { title: 'Hi' }))
    expect(res.status).toBe(403)
  })

  it('400 validation failure (missing title)', async () => {
    const res = await POST(req('POST', {}))
    expect(res.status).toBe(400)
  })

  it('creates slide with minimal body (defaults applied)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ next: 3 })     // order row
      .mockResolvedValueOnce({ id: 'new-id' }) // insert returning id
      .mockResolvedValueOnce({ id: 'new-id', title: 'Hi' }) // select
    const res = await POST(req('POST', { title: 'Hi' }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.slide.id).toBe('new-id')
  })

  it('creates slide with all optional fields set', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ next: 0 })
      .mockResolvedValueOnce({ id: 'nid' })
      .mockResolvedValueOnce({ id: 'nid' })
    const res = await POST(req('POST', {
      title: 'Full', subtitle: 'sub', badgeText: 'NEW', badgeColor: 'bg-red-500',
      imageUrl: '/a.jpg', imageUrlMobile: '/m.jpg', ctaLabel: 'Buy', ctaUrl: '/shop',
      filterCategory: 'cat', filterBrand: 'br', filterGrade: 'gr', filterMaterial: 'mat',
      filterMinPrice: 10, filterMaxPrice: 100, filterInStock: true, filterOnSale: true, isActive: false,
    }))
    expect(res.status).toBe(200)
  })

  it('uses fallback order 0 when orderRow is null', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)             // order row null -> nextOrder 0
      .mockResolvedValueOnce({ id: 'nid' })
      .mockResolvedValueOnce({ id: 'nid' })
    const res = await POST(req('POST', { title: 'Hi' }))
    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/admin/hero-slides (reorder)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await PATCH(req('PATCH', { order: ['a'] }))
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await PATCH(req('PATCH', { order: ['a'] }))
    expect(res.status).toBe(403)
  })

  it('400 when order empty', async () => {
    const res = await PATCH(req('PATCH', { order: [] }))
    expect(res.status).toBe(400)
  })

  it('400 when order missing (invalid JSON => {})', async () => {
    const res = await PATCH(badReq('PATCH'))
    expect(res.status).toBe(400)
  })

  it('400 when order not an array', async () => {
    const res = await PATCH(req('PATCH', { order: 'nope' }))
    expect(res.status).toBe(400)
  })

  it('reorders slides in one atomic statement', async () => {
    mockClientQuery.mockResolvedValue({})
    const res = await PATCH(req('PATCH', { order: ['id1', 'id2', 'id3'] }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    // One UPDATE ... unnest(...) WITH ORDINALITY, not N sequential updates.
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockClientQuery.mock.calls[0]
    expect(sql).toContain('WITH ORDINALITY')
    expect(params[0]).toEqual(['id1', 'id2', 'id3'])
  })
})
