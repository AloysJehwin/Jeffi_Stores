import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))

import { GET } from '@/app/api/(admin)/admin/agent/tool-logs/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['settings'] }

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/agent/tool-logs')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

const sampleMessages = [
  {
    id: 'm1',
    conversation_id: 'c1',
    created_at: '2024-01-01',
    tool_calls: [],
    admin_username: 'admin',
    admin_first_name: 'Ad',
    admin_last_name: 'Min',
  },
]

describe('GET /api/admin/agent/tool-logs', () => {
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

  it('returns messages and total on success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery
      .mockResolvedValueOnce({ rows: sampleMessages, rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 } as any)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('returns empty list with total 0 when no messages', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 } as any)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toEqual([])
    expect(body.total).toBe(0)
  })

  it('handles pagination params', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [{ total: '50' }], rowCount: 1 } as any)

    const res = await GET(makeRequest({ page: '2', pageSize: '20' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(50)
  })

  it('handles missing total row gracefully', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(0)
  })

  it('returns 500 on database error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockRejectedValue(new Error('connection refused'))

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('connection refused')
  })
})
