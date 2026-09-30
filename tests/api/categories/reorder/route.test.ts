import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
const { authenticateAdminMock } = vi.hoisted(() => ({ authenticateAdminMock: vi.fn() }))
vi.mock('@/lib/jwt', async () => {
  const { NextResponse } = await import('next/server')
  const { hasScope } = await vi.importActual<typeof import('@/lib/scopes')>('@/lib/scopes')
  return {
    authenticateAdmin: authenticateAdminMock,
    authenticateAnyUser: vi.fn(),
    authenticateUser: vi.fn(),
    verifyToken: vi.fn(),
    requireAdminScope: async (_req: unknown, scope: string | null) => {
      const admin = await authenticateAdminMock()
      if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (scope && !hasScope(admin.role, admin.scopes, scope)) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }
      return admin
    },
  }
})

import { PATCH } from '@/app/api/categories/reorder/route'
import { query } from '@/lib/db'

const mockAuth = authenticateAdminMock
const mockQuery = vi.mocked(query)
const ADMIN = { id: 'admin1', role: 'editor', scopes: ['categories:write'] }

function makeRequest(body: object) {
  return new Request('http://localhost/api/categories/reorder', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/categories/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not admin', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await PATCH(makeRequest({ updates: [] }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the admin lacks categories:write', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'admin1', role: 'viewer', scopes: ['categories:read'] } as any)
    const res = await PATCH(makeRequest({ updates: [] }) as any)
    expect(res.status).toBe(403)
  })

  it('returns 400 when updates is empty', async () => {
    mockAuth.mockResolvedValueOnce(ADMIN as any)
    const res = await PATCH(makeRequest({ updates: [] }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('No updates provided')
  })

  it('returns 400 when updates is not an array', async () => {
    mockAuth.mockResolvedValueOnce(ADMIN as any)
    const res = await PATCH(makeRequest({ updates: 'bad' }) as any)
    expect(res.status).toBe(400)
  })

  it('runs update query and returns success', async () => {
    mockAuth.mockResolvedValueOnce(ADMIN as any)
    mockQuery.mockResolvedValueOnce(undefined as any)

    const res = await PATCH(
      makeRequest({
        updates: [
          { id: 'cat1', display_order: 1, parent_category_id: null },
          { id: 'cat2', display_order: 2, parent_category_id: 'cat1' },
        ],
      }) as any
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(mockQuery).toHaveBeenCalled()
  })

  it('returns 500 on db error', async () => {
    mockAuth.mockResolvedValueOnce(ADMIN as any)
    mockQuery.mockRejectedValueOnce(new Error('constraint violation'))

    const res = await PATCH(
      makeRequest({
        updates: [{ id: 'cat1', display_order: 1, parent_category_id: null }],
      }) as any
    )
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('constraint violation')
  })
})
