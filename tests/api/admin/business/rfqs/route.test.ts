import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  requireAdminScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/business/rfqs/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryCount } from '@/lib/shared/db'

const mockRequireScope = vi.mocked(requireAdminScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['business_rfqs'],
}

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/business/rfqs')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid' },
  })
}

const sampleRfqs = [
  { id: 'rfq-1', rfq_number: 'RFQ-001', status: 'open', item_count: 3 },
  { id: 'rfq-2', rfq_number: 'RFQ-002', status: 'reviewed', item_count: 1 },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/business/rfqs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401/403 when requireAdminScope rejects', async () => {
    mockRequireScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns paginated RFQ list', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryMany.mockResolvedValue(sampleRfqs)
    mockQueryCount.mockResolvedValue(2)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rfqs).toHaveLength(2)
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(25)
  })

  it('filters by status when status param is provided', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryMany.mockResolvedValue([sampleRfqs[0]])
    mockQueryCount.mockResolvedValue(1)

    const res = await GET(makeRequest({ status: 'open' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rfqs).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('returns page 2 correctly', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(30)

    const res = await GET(makeRequest({ page: '2' }))
    const body = await res.json()
    expect(body.page).toBe(2)
    expect(body.total).toBe(30)
  })

  it('clamps page to minimum 1', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)

    const res = await GET(makeRequest({ page: '-5' }))
    const body = await res.json()
    expect(body.page).toBe(1)
  })

  it('returns empty list when no RFQs exist', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.rfqs).toEqual([])
    expect(body.total).toBe(0)
  })
})
