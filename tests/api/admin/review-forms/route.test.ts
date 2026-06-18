import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  queryCount: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/search', () => ({
  buildSearchClause: vi.fn().mockReturnValue({ clause: 'TRUE', params: [], nextIdx: 2 }),
}))

import { GET, POST } from '@/app/api/admin/review-forms/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryCount } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['review_forms'] }

function makeGetReq(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/review-forms')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}
function makePostReq(body: any) {
  return new NextRequest('http://localhost/api/admin/review-forms', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/review-forms', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(403)
  })

  it('returns forms and total on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const forms = [{ id: 'rf-1', title: 'Rate your purchase', slug: 'rate-purchase' }]
    mockQueryMany.mockResolvedValue(forms)
    mockQueryCount.mockResolvedValue(1)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.forms).toEqual(forms)
    expect(body.total).toBe(1)
  })

  it('passes search to buildSearchClause', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const { buildSearchClause } = await import('@/lib/search')
    await GET(makeGetReq({ search: 'rate' }))
    expect(buildSearchClause).toHaveBeenCalledWith('rate', expect.any(Array), expect.any(Number))
  })

  it('handles page param correctly', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(50)
    const res = await GET(makeGetReq({ page: '2' }))
    expect(res.status).toBe(200)
    // offset 25 should be passed as param
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([25, 25])
    )
  })
})

describe('POST /api/admin/review-forms', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostReq({ title: 'Test', slug: 'test' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePostReq({ title: 'Test', slug: 'test' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when title missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostReq({ slug: 'test', google_review_url: 'https://g.co/r/test' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/title/)
  })

  it('returns 400 when slug missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostReq({ title: 'Test', google_review_url: 'https://g.co/r/test' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/slug/)
  })

  it('returns 400 when google_review template missing url', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makePostReq({ title: 'Test', slug: 'test' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/google_review_url/)
  })

  it('creates form on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const form = { id: 'rf-1', title: 'Test Form', slug: 'test-form' }
    mockQueryMany.mockResolvedValue([form])
    const res = await POST(makePostReq({
      title: 'Test Form',
      slug: 'test-form',
      google_review_url: 'https://g.co/r/test',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.form).toEqual(form)
  })

  it('returns 409 on duplicate slug', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }))
    const res = await POST(makePostReq({
      title: 'Test Form',
      slug: 'existing-slug',
      google_review_url: 'https://g.co/r/test',
    }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/Slug already exists/)
  })

  it('creates form with custom template_type skipping google_review_url check', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const form = { id: 'rf-2', title: 'NPS Form', slug: 'nps-form' }
    mockQueryMany.mockResolvedValue([form])
    const res = await POST(makePostReq({
      title: 'NPS Form',
      slug: 'nps-form',
      template_type: 'nps',
      google_review_url: 'https://g.co/r/nps',
    }))
    expect(res.status).toBe(201)
  })
})
