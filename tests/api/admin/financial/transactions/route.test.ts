import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
  requireAdminScope: vi.fn(),
}))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/(admin)/admin/financial/transactions/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const mockRequire = vi.mocked(requireAdminScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['financial'] }

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/financial/transactions')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

// Route calls queryOne twice (current + previous totals) and queryMany three times
// (series, method breakdown, party breakdown) via Promise.all.
function stubAllDb() {
  mockQueryOne.mockResolvedValue({ inflow: '0', outflow: '0', count: '0' } as any)
  mockQueryMany.mockResolvedValue([] as any)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/financial/transactions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when the scope guard refuses', async () => {
    mockRequire.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as any
    )
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })

  it('returns 403 when the scope guard denies', async () => {
    mockRequire.mockResolvedValue(
      NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) as any
    )
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
  })

  it('returns the FinanceOverviewContract envelope on happy path', async () => {
    mockRequire.mockResolvedValue(admin as any)
    mockQueryOne
      .mockResolvedValueOnce({ inflow: '5000.00', outflow: '2000.00', count: '7' } as any)
      .mockResolvedValueOnce({ inflow: '3000.00', outflow: '1000.00', count: '3' } as any)
    mockQueryMany
      .mockResolvedValueOnce([{ label: '2024-01-01', inflow: '5000', outflow: '2000' }] as any)
      .mockResolvedValueOnce([{ method: 'order', inflow: '5000', outflow: '0', count: '5' }] as any)
      .mockResolvedValueOnce([
        { party: 'John Doe', party_type: 'customer', user_id: 'u1', supplier_id: null, expense_id: null, inflow: '5000', outflow: '0', count: '5' },
      ] as any)

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      range: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      previous_range: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      bucket: expect.any(String),
      current: { inflow: 5000, outflow: 2000, net: 3000, count: 7 },
      previous: { inflow: 3000, outflow: 1000, net: 2000, count: 3 },
    })
    expect(body.series).toEqual([{ label: '2024-01-01', inflow: 5000, outflow: 2000 }])
    expect(body.by_method).toEqual([{ method: 'order', inflow: 5000, outflow: 0, count: 5 }])
    expect(body.by_party[0]).toMatchObject({ party: 'John Doe', party_type: 'customer', inflow: 5000, count: 5 })
  })

  it('passes the parsed from/to to the aggregate query', async () => {
    mockRequire.mockResolvedValue(admin as any)
    stubAllDb()

    await GET(makeGet({ from: '2024-01-01', to: '2024-12-31' }))
    const [, params] = mockQueryOne.mock.calls[0] as [string, any[]]
    expect(params).toContain('2024-01-01')
    expect(params).toContain('2024-12-31')
  })

  it('rejects a malformed from/to with 400', async () => {
    mockRequire.mockResolvedValue(admin as any)
    const res = await GET(makeGet({ from: 'bad', to: '2024-12-31' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/from and to/i)
  })

  it('defaults net/count/inflow/outflow to 0 when the aggregate row is null', async () => {
    mockRequire.mockResolvedValue(admin as any)
    mockQueryOne.mockResolvedValue(null as any)
    mockQueryMany.mockResolvedValue([] as any)

    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.current).toEqual({ inflow: 0, outflow: 0, net: 0, count: 0 })
    expect(body.previous).toEqual({ inflow: 0, outflow: 0, net: 0, count: 0 })
  })

  it('returns 500 when an unexpected error escapes the handler', async () => {
    mockRequire.mockResolvedValue(admin as any)
    // parsePeriod itself does not throw for defaults; make the aggregate throw a non-caught error
    // by stubbing queryOne to reject AND the route's `.catch(() => null)` would normally swallow it.
    // Instead, break parsePeriod's inputs via unreachable path: force Promise.all to reject by
    // making queryMany reject synchronously (its `.catch` on the inner call returns []), so the
    // only path left is a thrown error from a helper. We spy on queryOne so it rejects before
    // the inner catch — the outer try/catch returns 500.
    const err = new Error('connection timeout')
    mockQueryOne.mockImplementation(() => {
      throw err
    })
    mockQueryMany.mockResolvedValue([] as any)

    const res = await GET(makeGet())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/connection timeout/i)
  })
})
