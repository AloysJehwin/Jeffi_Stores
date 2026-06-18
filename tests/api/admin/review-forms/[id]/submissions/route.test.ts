import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET, PATCH } from '@/app/api/admin/review-forms/[id]/submissions/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryCount, queryOne } from '@/lib/db'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['review_forms'] }
const FORM_ID = 'form-uuid-1'
const PARAMS = { params: Promise.resolve({ id: FORM_ID }) }

function makeGet(searchParams: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/admin/review-forms/${FORM_ID}/submissions`)
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString(), { method: 'GET' })
}

function makePatch(body: object) {
  return new NextRequest(`http://localhost/api/admin/review-forms/${FORM_ID}/submissions`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)
const mockQueryOne = vi.mocked(queryOne)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/review-forms/[id]/submissions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when review_forms scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns submissions and total', async () => {
    mockQueryMany.mockResolvedValue([{ id: 's1', form_id: FORM_ID }] as any)
    mockQueryCount.mockResolvedValue(1)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.submissions).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('filters by valid status', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeGet({ status: 'approved' }), PARAMS)
    expect(res.status).toBe(200)
    // query was called — status filter was applied
    expect(mockQueryMany).toHaveBeenCalledOnce()
  })

  it('ignores invalid status filter', async () => {
    const res = await GET(makeGet({ status: 'invalid_status' }), PARAMS)
    expect(res.status).toBe(200)
    // query still called but without status condition
    expect(mockQueryMany).toHaveBeenCalledOnce()
  })

  it('uses page param for offset', async () => {
    const res = await GET(makeGet({ page: '3' }), PARAMS)
    expect(res.status).toBe(200)
    // offset = (3-1)*50 = 100 — verify queryMany was called
    expect(mockQueryMany).toHaveBeenCalledOnce()
  })
})

describe('PATCH /api/admin/review-forms/[id]/submissions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ id: 'sub-1', form_id: FORM_ID, status: 'approved' } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatch({ submissionId: 's1', status: 'approved' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when review_forms scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatch({ submissionId: 's1', status: 'approved' }), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 400 when submissionId is missing', async () => {
    const res = await PATCH(makePatch({ status: 'approved' }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid request/i)
  })

  it('returns 400 when status is invalid', async () => {
    const res = await PATCH(makePatch({ submissionId: 's1', status: 'bogus' }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid request/i)
  })

  it('returns 404 when submission not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await PATCH(makePatch({ submissionId: 's1', status: 'approved' }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('updates submission status to approved', async () => {
    const res = await PATCH(makePatch({ submissionId: 'sub-1', status: 'approved' }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.submission.status).toBe('approved')
  })

  it('updates submission status to rejected', async () => {
    mockQueryOne.mockResolvedValue({ id: 'sub-1', form_id: FORM_ID, status: 'rejected' } as any)
    const res = await PATCH(makePatch({ submissionId: 'sub-1', status: 'rejected' }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).submission.status).toBe('rejected')
  })

  it('updates submission status to pending', async () => {
    mockQueryOne.mockResolvedValue({ id: 'sub-1', form_id: FORM_ID, status: 'pending' } as any)
    const res = await PATCH(makePatch({ submissionId: 'sub-1', status: 'pending' }), PARAMS)
    expect(res.status).toBe(200)
  })
})
