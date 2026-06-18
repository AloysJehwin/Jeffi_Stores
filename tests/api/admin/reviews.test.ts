import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, PATCH } from '@/app/api/admin/reviews/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', role: 'super_admin', scopes: ['reviews'] }

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/reviews')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

function makePatch(body: unknown) {
  return new NextRequest('http://localhost/api/admin/reviews', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sampleReviews = [
  { id: 'rev-1', rating: 5, comment: 'Great', is_approved: false, users: {}, products: {} },
]

// ── Tests: GET ────────────────────────────────────────────────────────────────

describe('GET /api/admin/reviews', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns reviews list with defaults (pending filter)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '3' })
    mockQueryMany.mockResolvedValue(sampleReviews)

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reviews).toHaveLength(1)
    expect(body.total).toBe(3)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(25)
  })

  it('applies approved filter', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '1' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ filter: 'approved' }))
    const countCall = mockQueryOne.mock.calls[0][1] as unknown[]
    expect(countCall).toContain(true)
  })

  it('applies search query filter', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '0' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeGet({ q: 'widget' }))
    const countCall = mockQueryOne.mock.calls[0][1] as unknown[]
    expect(countCall.some(p => typeof p === 'string' && (p as string).includes('widget'))).toBe(true)
  })

  it('handles all filter (no status condition)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '5' })
    mockQueryMany.mockResolvedValue(sampleReviews)

    const res = await GET(makeGet({ filter: 'all' }))
    expect(res.status).toBe(200)
  })

  it('respects pageSize and page params', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '100' })
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeGet({ pageSize: '10', page: '3' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(3)
    expect(body.pageSize).toBe(10)
  })

  it('caps pageSize at 200', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '0' })
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeGet({ pageSize: '9999' }))
    const body = await res.json()
    expect(body.pageSize).toBe(200)
  })

  it('returns empty reviews when queryMany returns null-ish', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue(null as any)

    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.reviews).toEqual([])
    expect(body.total).toBe(0)
  })

  it('returns 500 on DB error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB error'))
    const res = await GET(makeGet())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/failed to fetch/i)
  })
})

// ── Tests: PATCH ──────────────────────────────────────────────────────────────

describe('PATCH /api/admin/reviews', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatch({ reviewId: 'r1', action: 'approve' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatch({ reviewId: 'r1', action: 'approve' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when reviewId is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makePatch({ action: 'approve' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/review id and action/i)
  })

  it('returns 400 when action is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makePatch({ reviewId: 'r1' }))
    expect(res.status).toBe(400)
  })

  it('approves a review', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue(undefined as any)

    const res = await PATCH(makePatch({ reviewId: 'r1', action: 'approve' }))
    expect(res.status).toBe(200)
    expect((await res.json()).message).toMatch(/approved/i)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('is_approved = true'),
      ['r1']
    )
  })

  it('rejects (deletes) a review', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue(undefined as any)

    const res = await PATCH(makePatch({ reviewId: 'r2', action: 'reject' }))
    expect(res.status).toBe(200)
    expect((await res.json()).message).toMatch(/deleted/i)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM product_reviews'),
      ['r2']
    )
  })

  it('returns 400 for invalid action', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makePatch({ reviewId: 'r1', action: 'frobnicate' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid action/i)
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockRejectedValue(new Error('boom'))
    const res = await PATCH(makePatch({ reviewId: 'r1', action: 'approve' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/failed to update/i)
  })
})
