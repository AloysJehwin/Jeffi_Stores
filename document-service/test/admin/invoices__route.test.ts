import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/catalog/search', () => ({
  buildVectorSearchClause: vi.fn().mockImplementation((_raw, _vec, _trgm, _exact, idx) => ({
    clause: 'TRUE',
    params: [],
    nextIdx: idx + 1,
  })),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/(admin)/admin/invoices/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['invoices'],
}

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/invoices')
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v)
  }
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid-token' },
  })
}

const sampleInvoices = [
  {
    id: 'inv-1',
    invoice_number: 'INV-2024-001',
    order_number: 'ORD-001',
    customer_name: 'Alice Smith',
    total_amount: 1200,
    payment_status: 'paid',
    source: 'website',
    created_at: '2024-01-15T10:00:00Z',
  },
  {
    id: 'inv-2',
    invoice_number: 'INV-2024-002',
    order_number: 'ORD-002',
    customer_name: 'Bob Jones',
    total_amount: 850,
    payment_status: 'pending',
    source: 'website',
    created_at: '2024-01-16T09:00:00Z',
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/invoices', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns invoice list with pagination metadata', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleInvoices)
    mockQueryOne.mockResolvedValue({ count: '2' })

    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoices).toHaveLength(2)
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.limit).toBe(25)
  })

  it('paginates correctly on page 2', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue({ count: '30' })

    const req = makeRequest({ page: '2' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(2)
    expect(body.total).toBe(30)
  })

  it('returns empty list with total 0 when no invoices exist', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue({ count: '0' })

    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoices).toEqual([])
    expect(body.total).toBe(0)
  })

  it('handles payment filter parameter', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([sampleInvoices[0]])
    mockQueryOne.mockResolvedValue({ count: '1' })

    const req = makeRequest({ payment: 'paid' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoices).toHaveLength(1)
  })

  it('handles date range filters', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleInvoices)
    mockQueryOne.mockResolvedValue({ count: '2' })

    const req = makeRequest({ from: '2024-01-01', to: '2024-01-31' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoices).toHaveLength(2)
  })

  it('handles source filter for cash_sale', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue({ count: '0' })

    const req = makeRequest({ source: 'cash_sale' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoices).toEqual([])
  })

  it('handles search query parameter', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([sampleInvoices[0]])
    mockQueryOne.mockResolvedValue({ count: '1' })

    const req = makeRequest({ search: 'Alice' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoices).toHaveLength(1)
  })

  it('returns 500 on database error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockRejectedValue(new Error('DB connection failed'))

    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/DB connection failed/i)
  })

  it('handles null count gracefully (returns 0)', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue(null)

    const req = makeRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(0)
  })
})
