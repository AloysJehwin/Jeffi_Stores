import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/search', () => ({
  buildVectorSearchClause: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/cash-sale/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne } from '@/lib/db'
import { buildVectorSearchClause } from '@/lib/search'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['invoices'] }

function makeGet(qs = '') {
  return new NextRequest(`http://localhost/api/admin/cash-sale${qs}`)
}

const SALE_ROWS = [
  {
    id: 'cs-1',
    order_number: 'CS-001',
    invoice_number: 'INV-001',
    customer_name: 'John',
    total_amount: '1000',
    payment_status: 'paid',
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/cash-sale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 403 when missing invoices scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Insufficient permissions' })
  })

  it('returns sales list with total and pagination defaults', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue(SALE_ROWS as any)
    vi.mocked(queryOne).mockResolvedValue({ count: '1' } as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sales).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.limit).toBe(25)
  })

  it('passes payment filter to query', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(queryOne).mockResolvedValue({ count: '0' } as any)
    await GET(makeGet('?payment=paid'))
    const sql = vi.mocked(queryMany).mock.calls[0][0] as string
    expect(sql).toContain('payment_status')
  })

  it('passes date range filters to query', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(queryOne).mockResolvedValue({ count: '0' } as any)
    await GET(makeGet('?from=2024-01-01&to=2024-01-31'))
    const sql = vi.mocked(queryMany).mock.calls[0][0] as string
    expect(sql).toContain('invoice_date')
  })

  it('uses buildVectorSearchClause when search param present', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(buildVectorSearchClause).mockReturnValue({
      clause: 'cs.search_vector @@ to_tsquery($1)',
      params: ['test'],
      nextIdx: 2,
    } as any)
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(queryOne).mockResolvedValue({ count: '0' } as any)
    await GET(makeGet('?search=test'))
    expect(vi.mocked(buildVectorSearchClause)).toHaveBeenCalled()
  })

  it('handles page parameter correctly', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(queryOne).mockResolvedValue({ count: '100' } as any)
    const res = await GET(makeGet('?page=3'))
    const body = await res.json()
    expect(body.page).toBe(3)
    expect(body.total).toBe(100)
  })

  it('defaults page to 1 when page is zero or invalid', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(queryOne).mockResolvedValue({ count: '0' } as any)
    const res = await GET(makeGet('?page=0'))
    const body = await res.json()
    expect(body.page).toBe(1)
  })

  it('returns total 0 when countRow is null', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.total).toBe(0)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockRejectedValue(new Error('connection refused'))
    const res = await GET(makeGet())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'connection refused' })
  })
})
