import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

const { mockRequireAdminScope } = vi.hoisted(() => ({ mockRequireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: mockRequireAdminScope }))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { GET } from '@/app/api/admin/audit/mail-log/route'
import { queryMany, queryCount } from '@/lib/shared/db'

const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/audit/mail-log')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), { method: 'GET' })
}

const sampleRows = [
  {
    id: 'log-1',
    email: 'test@example.com',
    subject: 'Order confirmation',
    kind: 'transactional',
    status: 'sent',
    sent_at: '2026-06-01T10:00:00Z',
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/audit/mail-log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdminScope.mockResolvedValue({ adminId: 'admin-1', role: 'super_admin', scopes: [] })
  })

  it('returns 401 when not authenticated', async () => {
    mockRequireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('returns paginated rows and total', async () => {
    mockQueryMany.mockResolvedValue(sampleRows as any)
    mockQueryCount.mockResolvedValue(1)
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toEqual(sampleRows)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(25)
  })

  it('applies kind filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await GET(makeRequest({ kind: 'marketing' }))
    const queryCall = mockQueryMany.mock.calls[0]
    expect(queryCall[1]).toContain('marketing')
  })

  it('does not apply kind filter when kind=all', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await GET(makeRequest({ kind: 'all' }))
    const queryCall = mockQueryMany.mock.calls[0]
    expect(queryCall[0]).not.toContain('kind =')
  })

  it('applies status filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await GET(makeRequest({ status: 'failed' }))
    const queryCall = mockQueryMany.mock.calls[0]
    expect(queryCall[1]).toContain('failed')
  })

  it('does not apply status filter when status=all', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await GET(makeRequest({ status: 'all' }))
    const queryCall = mockQueryMany.mock.calls[0]
    expect(queryCall[0]).not.toContain('status =')
  })

  it('applies search query filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await GET(makeRequest({ q: 'invoice' }))
    const queryCall = mockQueryMany.mock.calls[0]
    expect(queryCall[1]).toContain('%invoice%')
  })

  it('returns page and pageSize from query params', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeRequest({ page: '3', pageSize: '10' }))
    const body = await res.json()
    expect(body.page).toBe(3)
    expect(body.pageSize).toBe(10)
  })

  it('clamps pageSize to max 100 and min 1', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeRequest({ pageSize: '9999' }))
    const body = await res.json()
    expect(body.pageSize).toBe(100)
  })

  it('defaults to page 1 when page is invalid', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeRequest({ page: '0' }))
    const body = await res.json()
    expect(body.page).toBe(1)
  })

  it('returns empty rows when no records match', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeRequest({ kind: 'transactional', status: 'failed', q: 'noresult' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toEqual([])
    expect(body.total).toBe(0)
  })
})
