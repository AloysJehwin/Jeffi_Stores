import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  requireAdminScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/business/customers/route'
import { requireAdminScope } from '@/lib/jwt'
import { queryMany, queryCount } from '@/lib/db'

const mockRequireScope = vi.mocked(requireAdminScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['business_customers'],
}

function setAuthSuccess() {
  mockRequireScope.mockResolvedValue(adminPayload as any)
}

function setAuthFailure(status = 401) {
  const errResponse = NextResponse.json({ error: 'Unauthorized' }, { status })
  mockRequireScope.mockResolvedValue(errResponse)
}

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/business/customers')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid-token' },
  })
}

const sampleCustomers = [
  {
    id: 'user-1',
    email: 'biz@example.com',
    first_name: 'Biz',
    last_name: 'Owner',
    company_name: 'Acme Corp',
    approval_status: 'approved',
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/business/customers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth error when scope check fails', async () => {
    setAuthFailure(401)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns paginated customers list', async () => {
    setAuthSuccess()
    mockQueryMany.mockResolvedValue(sampleCustomers as any)
    mockQueryCount.mockResolvedValue(1)
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customers).toEqual(sampleCustomers)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(25)
  })

  it('filters by approval status', async () => {
    setAuthSuccess()
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await GET(makeRequest({ status: 'pending' }))
    const countCall = mockQueryCount.mock.calls[0]
    expect(countCall[1]).toContain('pending')
  })

  it('filters by search query', async () => {
    setAuthSuccess()
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await GET(makeRequest({ q: 'Acme' }))
    const countCall = mockQueryCount.mock.calls[0]
    expect(countCall[1]).toContain('%Acme%')
  })

  it('handles combined status and search filters', async () => {
    setAuthSuccess()
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await GET(makeRequest({ status: 'approved', q: 'Corp' }))
    const queryCall = mockQueryMany.mock.calls[0]
    expect(queryCall[1]).toContain('approved')
    expect(queryCall[1]).toContain('%Corp%')
  })

  it('handles page pagination correctly', async () => {
    setAuthSuccess()
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(100)
    const res = await GET(makeRequest({ page: '3' }))
    const body = await res.json()
    expect(body.page).toBe(3)
    // offset should be (3-1)*25 = 50, check it's in query params
    const queryCall = mockQueryMany.mock.calls[0]
    expect(queryCall[1]).toContain(50) // offset value
  })

  it('returns empty customers when no results', async () => {
    setAuthSuccess()
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeRequest({ status: 'rejected' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customers).toEqual([])
    expect(body.total).toBe(0)
  })

  it('defaults to page 1 when page param is invalid', async () => {
    setAuthSuccess()
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeRequest({ page: '-1' }))
    const body = await res.json()
    expect(body.page).toBe(1)
  })
})
