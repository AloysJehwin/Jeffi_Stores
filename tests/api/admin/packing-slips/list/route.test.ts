import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/packing-slips/list/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['packing_slips'] }

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/packing-slips/list')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString(), { method: 'GET' })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

const SAMPLE_ORDERS = [
  {
    id: 'o1',
    order_number: 'ORD-001',
    customer_name: 'Alice',
    created_at: '2026-01-01',
    status: 'confirmed',
    total_amount: 500,
  },
  {
    id: 'o2',
    order_number: 'ORD-002',
    customer_name: 'Bob',
    created_at: '2026-01-02',
    status: 'shipped',
    total_amount: 300,
  },
]

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/packing-slips/list', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(SAMPLE_ORDERS as any)
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when packing_slips scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  // ── Happy path — no filters ───────────────────────────────────────────────

  it('returns orders with default 30-day filter when no params given', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders).toHaveLength(2)
    // No bound params — default WHERE clause uses NOW() - INTERVAL
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), [])
  })

  // ── Date filters ─────────────────────────────────────────────────────────

  it('filters with both from and to', async () => {
    const res = await GET(makeReq({ from: '2026-01-01', to: '2026-01-31' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('$1::date'), ['2026-01-01', '2026-01-31'])
  })

  it('filters with only from', async () => {
    const res = await GET(makeReq({ from: '2026-01-01' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('$1::date'), ['2026-01-01'])
  })

  it('filters with only to', async () => {
    const res = await GET(makeReq({ to: '2026-01-31' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('$1::date'), ['2026-01-31'])
  })

  // ── Empty result ─────────────────────────────────────────────────────────

  it('returns empty orders array when query returns null', async () => {
    mockQueryMany.mockResolvedValue(null as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect((await res.json()).orders).toEqual([])
  })
})
