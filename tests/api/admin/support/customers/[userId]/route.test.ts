import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

import { GET } from '@/app/api/admin/support/customers/[userId]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['customers'] }

function makeReq(userId: string) {
  return new NextRequest(`http://localhost/api/admin/support/customers/${userId}`)
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/support/customers/[userId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq('u1'), { params: Promise.resolve({ userId: 'u1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq('u1'), { params: Promise.resolve({ userId: 'u1' }) })
    expect(res.status).toBe(403)
  })

  it('returns session: null when no open session', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeReq('u1'), { params: Promise.resolve({ userId: 'u1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session).toBeNull()
  })

  it('returns open session on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const session = { id: 's1', status: 'open', created_at: '2024-01-01', admin_name: 'Admin', last_activity_at: '2024-01-01' }
    mockQueryOne.mockResolvedValue(session)
    const res = await GET(makeReq('u1'), { params: Promise.resolve({ userId: 'u1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    // Route now augments the session with a server-computed staleForClose flag.
    // With a 2024 last_activity_at, the session is well past the stale threshold.
    expect(body.session).toMatchObject({ id: 's1', status: 'open', admin_name: 'Admin' })
    expect(body.session.staleForClose).toBe(true)
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB down'))
    const res = await GET(makeReq('u1'), { params: Promise.resolve({ userId: 'u1' }) })
    expect(res.status).toBe(500)
  })
})
