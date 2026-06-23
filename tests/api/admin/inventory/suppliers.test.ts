import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/search', () => ({ buildSearchClause: vi.fn() }))
vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: 'zNonEmpty',
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/inventory/suppliers/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query } from '@/lib/db'
import { buildSearchClause } from '@/lib/search'
import { parseBody } from '@/lib/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockBuildSearch = vi.mocked(buildSearchClause)
const mockParseBody = vi.mocked(parseBody)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['inventory'] }

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/inventory/suppliers')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/inventory/suppliers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sampleSuppliers = [
  { id: 'sup-1', name: 'Acme Supplies', gstin: 'GST123', po_count: 5 },
]

const validSupplierBody = {
  name: 'New Supplier',
  email: 'supplier@example.com',
  phone: '9876543210',
  gstin: 'GST456',
}

// ── Tests: GET ────────────────────────────────────────────────────────────────

describe('GET /api/admin/inventory/suppliers', () => {
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

  it('returns supplier list with defaults', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: 1 })
    mockQueryMany.mockResolvedValue(sampleSuppliers as any)

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suppliers).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.limit).toBe(20)
  })

  it('includes inactive suppliers when all=true', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: 3 })
    mockQueryMany.mockResolvedValue(sampleSuppliers as any)

    await GET(makeGet({ all: 'true' }))
    // When includeInactive, the WHERE clause should NOT contain is_active
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).not.toContain('is_active')
  })

  it('excludes inactive suppliers by default', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: 1 })
    mockQueryMany.mockResolvedValue(sampleSuppliers as any)

    await GET(makeGet())
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('is_active')
  })

  it('applies search clause when search param provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: 0 })
    mockQueryMany.mockResolvedValue([])
    mockBuildSearch.mockReturnValue({ clause: 'SEARCH_CLAUSE', params: ['%acme%'], nextIdx: 2 })

    await GET(makeGet({ search: 'acme' }))
    expect(mockBuildSearch).toHaveBeenCalledWith('acme', expect.any(Array), 1)
  })

  it('handles pagination correctly', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: 100 })
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeGet({ page: '3', limit: '10' }))
    const body = await res.json()
    expect(body.page).toBe(3)
    expect(body.limit).toBe(10)
  })

  it('returns empty suppliers when queryMany returns null', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: 0 })
    mockQueryMany.mockResolvedValue(null as any)

    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.suppliers).toEqual([])
  })

  it('returns 500 on DB error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('connection refused'))

    const res = await GET(makeGet())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/connection refused/i)
  })
})

// ── Tests: POST ───────────────────────────────────────────────────────────────

describe('POST /api/admin/inventory/suppliers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost(validSupplierBody))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost(validSupplierBody))
    expect(res.status).toBe(403)
  })

  it('returns 400 when body is invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const req = new NextRequest('http://localhost/api/admin/inventory/suppliers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'INVALID',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid json/i)
  })

  it('returns parseBody error when validation fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const errResp = new Response(JSON.stringify({ error: 'Validation failed' }), { status: 400 })
    mockParseBody.mockReturnValue({ ok: false, response: errResp } as any)

    const res = await POST(makePost({ name: '' }))
    expect(res.status).toBe(400)
  })

  it('inserts supplier and returns id on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        name: 'New Supplier',
        gstin: null, contact_name: null, phone: null, email: null,
        address: null, payment_terms: '30', notes: null,
        bank_name: null, account_number: null, ifsc: null, upi_id: null,
      },
    } as any)
    mockQueryOne.mockResolvedValue({ id: 'sup-new-1' })

    const res = await POST(makePost(validSupplierBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.id).toBe('sup-new-1')
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO suppliers'),
      expect.any(Array)
    )
  })

  it('returns 500 on DB insert error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({
      ok: true,
      data: { name: 'Supplier', payment_terms: '30' },
    } as any)
    mockQueryOne.mockRejectedValue(new Error('unique violation'))

    const res = await POST(makePost(validSupplierBody))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/unique violation/i)
  })
})
