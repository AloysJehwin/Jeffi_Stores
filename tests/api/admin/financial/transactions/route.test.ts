import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/financial/transactions/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['financial'] }

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/financial/transactions')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

// The route runs 3 parallel queryMany calls: count, rows, summary
function setupQueryMany(count: string, rows: any[], summaryRows: any[]) {
  mockQueryMany
    .mockResolvedValueOnce([{ count }] as any) // count query
    .mockResolvedValueOnce(rows as any) // rows query
    .mockResolvedValueOnce(summaryRows as any) // summary query
}

const sampleRow = {
  id: 'txn-1',
  direction: 'inflow',
  txn_date: '2024-01-01',
  amount: 1000,
  party: 'John Doe',
  txn_ref: 'ORD-001',
  method: 'order',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/financial/transactions', () => {
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
  })

  it('returns transactions with summary on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    setupQueryMany(
      '1',
      [sampleRow],
      [
        { direction: 'inflow', total: '5000.00' },
        { direction: 'outflow', total: '2000.00' },
      ]
    )

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.summary.total_inflow).toBe(5000)
    expect(body.summary.total_outflow).toBe(2000)
    expect(body.summary.net).toBe(3000)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(50)
  })

  it('applies from/to date filters', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    setupQueryMany('0', [], [])

    await GET(makeGet({ from: '2024-01-01', to: '2024-12-31' }))
    const countSql = mockQueryMany.mock.calls[0][0] as string
    expect(countSql).toContain('txn_date >= $')
    expect(countSql).toContain('txn_date <= $')
    const params = mockQueryMany.mock.calls[0][1] as any[]
    expect(params).toContain('2024-01-01')
    expect(params).toContain('2024-12-31')
  })

  it('applies inflow type filter', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    setupQueryMany('0', [], [])

    await GET(makeGet({ type: 'inflow' }))
    const countSql = mockQueryMany.mock.calls[0][0] as string
    expect(countSql).toContain("direction = 'inflow'")
  })

  it('applies outflow type filter', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    setupQueryMany('0', [], [])

    await GET(makeGet({ type: 'outflow' }))
    const countSql = mockQueryMany.mock.calls[0][0] as string
    expect(countSql).toContain("direction = 'outflow'")
  })

  it('applies search filter (party/reference/txn_ref)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    setupQueryMany('0', [], [])

    await GET(makeGet({ search: 'John' }))
    const countSql = mockQueryMany.mock.calls[0][0] as string
    expect(countSql).toContain('party ILIKE')
    const params = mockQueryMany.mock.calls[0][1] as any[]
    expect(params.some(p => typeof p === 'string' && p.includes('John'))).toBe(true)
  })

  it('computes net as 0 when no summary rows returned', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    setupQueryMany('0', [], [])

    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.summary.total_inflow).toBe(0)
    expect(body.summary.total_outflow).toBe(0)
    expect(body.summary.net).toBe(0)
  })

  it('returns correct page in response body', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    setupQueryMany('100', [], [])

    const res = await GET(makeGet({ page: '3' }))
    const body = await res.json()
    expect(body.page).toBe(3)
  })

  it('handles missing count row gracefully (defaults to 0)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany
      .mockResolvedValueOnce([] as any) // count returns empty array
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)

    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.total).toBe(0)
  })

  it('returns 500 on unexpected DB error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockRejectedValue(new Error('connection timeout'))

    const res = await GET(makeGet())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/connection timeout/i)
  })

  it('type=all does not add direction filter', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    setupQueryMany('0', [], [])

    await GET(makeGet({ type: 'all' }))
    const countSql = mockQueryMany.mock.calls[0][0] as string
    expect(countSql).not.toContain("direction = 'inflow'")
    expect(countSql).not.toContain("direction = 'outflow'")
  })
})
