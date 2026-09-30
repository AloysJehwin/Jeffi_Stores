import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))

import { GET } from '@/app/api/admin/agent/proposed-tools/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['agent'] }

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/agent/proposed-tools')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

const sampleTools = [
  { id: 't1', name: 'get_orders', description: 'List orders', kind: 'sql', status: 'proposed', invocation_count: 0 },
  { id: 't2', name: 'send_email', description: 'Send email', kind: 'email', status: 'proposed', invocation_count: 3 },
]

describe('GET /api/admin/agent/proposed-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('returns paginated list of proposed tools', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '2' })
    mockQueryMany.mockResolvedValue(sampleTools)

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

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), ['proposed'])
  })

  it('accepts status=all param', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '5' })
    mockQueryMany.mockResolvedValue(sampleTools)

    const res = await GET(makeRequest({ status: 'all' }))
    expect(res.status).toBe(200)
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), ['all'])
  })

  it('caps pageSize at 200', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '0' })
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeRequest({ pageSize: '999' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(200)
  })

  it('handles null countRow (returns total 0)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(0)
  })

  it('accepts limit as alias for pageSize', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: '0' })
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeRequest({ limit: '10' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(10)
  })
})
