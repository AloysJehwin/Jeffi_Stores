import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

import { GET } from '@/app/api/admin/agent/conversations/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['agent'] }

function makeReq(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/agent/conversations')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/agent/conversations', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns conversation items on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const rows = [{ id: 'conv-1', preview: 'hello', title: null, last_message_at: '2024-01-01', message_count: 3 }]
    mockQueryMany.mockResolvedValue(rows)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual(rows)
  })

  it('caps limit at 100', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    await GET(makeReq({ limit: '999' }))
    const call = mockQueryMany.mock.calls[0]
    // second param array contains the limit value
    expect(call[1]).toContain(100)
  })

  it('defaults limit to 30', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    await GET(makeReq())
    const call = mockQueryMany.mock.calls[0]
    expect(call[1]).toContain(30)
  })
})
