import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))

import { POST } from '@/app/api/admin/agent/actions/[id]/reject/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)

const admin = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['agent'] }
const params = Promise.resolve({ id: 'action-uuid-123' })

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/agent/actions/action-uuid-123/reject', { method: 'POST' })
}

describe('POST /api/admin/agent/actions/[id]/reject', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when action not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns 403 when action belongs to different admin', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ admin_id: 'other-admin', status: 'proposed' })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not your/i)
  })

  it('returns 400 when action is not in proposed status', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ admin_id: 'admin-1', status: 'approved' })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/approved/i)
  })

  it('rejects the action and returns ok', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ admin_id: 'admin-1', status: 'proposed' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('rejected')
    expect(mockQuery).toHaveBeenCalledOnce()
  })

  it('returns 400 for already rejected status', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ admin_id: 'admin-1', status: 'rejected' })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/rejected/i)
  })
})
