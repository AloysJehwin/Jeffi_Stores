import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))

import { GET } from '@/app/api/admin/catalog-enrichment/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['catalog_enrichment'] }

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/catalog-enrichment')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

const sampleRows = [
  { id: 'e1', product_id: 'p1', product_name: 'Widget', status: 'proposed', ai_description: 'A widget' },
  { id: 'e2', product_id: 'p2', product_name: 'Gadget', status: 'proposed', ai_description: 'A gadget' },
]

describe('GET /api/admin/catalog-enrichment', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns enrichment list with pagination', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '2' })
    mockQueryMany.mockResolvedValue(sampleRows)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(25)
  })

  it('defaults to status=proposed', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '0' })
    mockQueryMany.mockResolvedValue([])

    await GET(makeRequest())
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), ['proposed'])
  })

  it('accepts status=all', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '10' })
    mockQueryMany.mockResolvedValue(sampleRows)

    const res = await GET(makeRequest({ status: 'all' }))
    expect(res.status).toBe(200)
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), ['all'])
  })

  it('caps pageSize at 200', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '0' })
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeRequest({ pageSize: '500' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(200)
  })

  it('handles null countRow gracefully', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).total).toBe(0)
  })
})
