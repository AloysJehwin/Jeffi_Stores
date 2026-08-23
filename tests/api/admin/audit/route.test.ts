import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/audit/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryCount } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)

// ── Helpers ───────────────────────────────────────────────────────────────────

const superAdmin = {
  adminId: 'admin-1',
  username: 'superadmin',
  role: 'super_admin',
  scopes: [],
}

const regularAdmin = {
  adminId: 'admin-2',
  username: 'regularadmin',
  role: 'admin',
  scopes: ['audit'],
}

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/audit')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid-token' },
  })
}

const sampleRows = [
  { id: 'log-1', action: 'create', entity_type: 'product', summary: 'Created product' },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/audit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when regular admin lacks audit scope', async () => {
    mockAuth.mockResolvedValue({ ...regularAdmin, scopes: [] })
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('allows super_admin (hasScope grants platform owner)', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    mockQueryCount.mockResolvedValue(1)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  it('allows regular admin with audit scope', async () => {
    mockAuth.mockResolvedValue(regularAdmin)
    mockHasScope.mockReturnValue(true)
    mockQueryCount.mockResolvedValue(1)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  it('returns paginated events on success', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    mockQueryCount.mockResolvedValue(5)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    const res = await GET(makeRequest({ page: '1', pageSize: '10' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual(sampleRows)
    expect(body.total).toBe(5)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(10)
  })

  it('applies entity_type filter', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    mockQueryCount.mockResolvedValue(2)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    await GET(makeRequest({ entity_type: 'product' }))
    const countCall = mockQueryCount.mock.calls[0]
    expect(countCall[1]).toContain('product')
  })

  it('applies action filter', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    mockQueryCount.mockResolvedValue(2)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    await GET(makeRequest({ action: 'create' }))
    const countCall = mockQueryCount.mock.calls[0]
    expect(countCall[1]).toContain('create')
  })

  it('applies admin_id filter', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    mockQueryCount.mockResolvedValue(2)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    await GET(makeRequest({ admin_id: 'some-uuid' }))
    const countCall = mockQueryCount.mock.calls[0]
    expect(countCall[1]).toContain('some-uuid')
  })

  it('clamps page size to valid range', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    mockQueryCount.mockResolvedValue(0)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest({ page: '0', pageSize: '9999' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(200)
    expect(body.page).toBe(1)
  })

  it('returns empty events when no records', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    mockQueryCount.mockResolvedValue(0)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual([])
    expect(body.total).toBe(0)
  })
})
