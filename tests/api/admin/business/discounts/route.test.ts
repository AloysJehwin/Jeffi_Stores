import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  requireAdminScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/(admin)/admin/business/discounts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { query, queryMany } from '@/lib/shared/db'

const mockRequireScope = vi.mocked(requireAdminScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['business_customers'],
}

// requireAdminScope returns NextResponse on auth failure, or the admin payload on success
function setAuthSuccess() {
  mockRequireScope.mockResolvedValue(adminPayload as any)
}

function setAuthFailure(status = 401) {
  const errResponse = NextResponse.json({ error: 'Unauthorized' }, { status })
  mockRequireScope.mockResolvedValue(errResponse)
}

function makeGetRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/business/discounts')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid-token' },
  })
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/business/discounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid-token' },
    body: JSON.stringify(body),
  })
}

const sampleDiscounts = [
  { id: 'disc-1', user_id: 'user-1', category_id: 'cat-1', category_name: 'Electronics', discount_pct: 10 },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/business/discounts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth error response when scope check fails', async () => {
    setAuthFailure(401)
    const res = await GET(makeGetRequest({ user_id: 'user-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when user_id is missing', async () => {
    setAuthSuccess()
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/user_id required/i)
  })

  it('returns discounts list for a user', async () => {
    setAuthSuccess()
    mockQueryMany.mockResolvedValue(sampleDiscounts as any)
    const res = await GET(makeGetRequest({ user_id: 'user-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.discounts).toEqual(sampleDiscounts)
  })

  it('returns empty discounts array when none found', async () => {
    setAuthSuccess()
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGetRequest({ user_id: 'user-no-disc' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.discounts).toEqual([])
  })
})

describe('POST /api/admin/business/discounts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth error response when scope check fails', async () => {
    setAuthFailure(403)
    const res = await POST(makePostRequest({ userId: 'u1', categoryId: 'c1', discountPct: 10 }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when userId is missing', async () => {
    setAuthSuccess()
    const res = await POST(makePostRequest({ categoryId: 'c1', discountPct: 10 }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/userId.*categoryId.*discountPct/i)
  })

  it('returns 400 when categoryId is missing', async () => {
    setAuthSuccess()
    const res = await POST(makePostRequest({ userId: 'u1', discountPct: 10 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when discountPct is null/missing', async () => {
    setAuthSuccess()
    const res = await POST(makePostRequest({ userId: 'u1', categoryId: 'c1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when discountPct is NaN', async () => {
    setAuthSuccess()
    const res = await POST(makePostRequest({ userId: 'u1', categoryId: 'c1', discountPct: 'not-a-number' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/between 0 and 100/i)
  })

  it('returns 400 when discountPct is negative', async () => {
    setAuthSuccess()
    const res = await POST(makePostRequest({ userId: 'u1', categoryId: 'c1', discountPct: -5 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when discountPct exceeds 100', async () => {
    setAuthSuccess()
    const res = await POST(makePostRequest({ userId: 'u1', categoryId: 'c1', discountPct: 101 }))
    expect(res.status).toBe(400)
  })

  it('deletes discount when discountPct is 0', async () => {
    setAuthSuccess()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await POST(makePostRequest({ userId: 'u1', categoryId: 'c1', discountPct: 0 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.deleted).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE'), ['u1', 'c1'])
  })

  it('upserts discount and returns success', async () => {
    setAuthSuccess()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await POST(makePostRequest({ userId: 'u1', categoryId: 'c1', discountPct: 15 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.deleted).toBeUndefined()
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), ['u1', 'c1', 15])
  })
})
