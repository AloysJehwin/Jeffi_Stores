import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/search', () => ({
  buildSearchClause: vi.fn().mockReturnValue({ clause: 'TRUE', params: [] }),
}))

import { GET } from '@/app/api/admin/customers/search/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import { buildSearchClause } from '@/lib/search'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockBuildSearchClause = vi.mocked(buildSearchClause)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['customers'] }

function makeRequest(q = '') {
  const url = new URL('http://localhost/api/admin/customers/search')
  if (q) url.searchParams.set('q', q)
  return new NextRequest(url.toString())
}

const sampleCustomers = [
  { id: 'u1', full_name: 'Alice Smith', email: 'alice@example.com', phone: '9999999999', company_name: null },
  { id: 'u2', full_name: 'Bob Jones', email: 'bob@example.com', phone: '8888888888', company_name: 'Acme' },
]

describe('GET /api/admin/customers/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildSearchClause.mockReturnValue({ clause: 'TRUE', params: [] })
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest('alice'))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest('alice'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns empty results when query is too short (< 2 chars)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await GET(makeRequest('a'))
    expect(res.status).toBe(200)
    expect((await res.json()).results).toEqual([])
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('returns empty results when query is empty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).results).toEqual([])
  })

  it('returns matching customers for valid query', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleCustomers)

    const res = await GET(makeRequest('alice'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(2)
    expect(body.results[0].full_name).toBe('Alice Smith')
  })

  it('returns empty array when queryMany returns null', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(null as any)

    const res = await GET(makeRequest('alice'))
    expect(res.status).toBe(200)
    expect((await res.json()).results).toEqual([])
  })

  it('returns 500 on database error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockRejectedValue(new Error('DB error'))

    const res = await GET(makeRequest('alice'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB error')
  })

  it('calls buildSearchClause with correct fields', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    await GET(makeRequest('alice smith'))
    expect(mockBuildSearchClause).toHaveBeenCalledWith(
      'alice smith',
      expect.arrayContaining(["u.first_name || ' ' || u.last_name"]),
      1
    )
  })
})
