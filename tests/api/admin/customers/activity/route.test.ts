import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/customers/[id]/activity/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['customers'],
}

function makeRequest(id = 'user-1', searchParams: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/admin/customers/${id}/activity`)
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_token=valid' },
  })
}

const sampleEvents = [
  {
    id: 'evt-1',
    kind: 'order_placed',
    reference_id: 'order-1',
    reference_type: 'order',
    summary: 'Placed order ORD-001',
    metadata: {},
    created_at: '2024-01-15T10:00:00Z',
    actor_id: null,
  },
  {
    id: 'evt-2',
    kind: 'login',
    reference_id: null,
    reference_type: null,
    summary: 'User logged in',
    metadata: {},
    created_at: '2024-01-14T09:00:00Z',
    actor_id: null,
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/customers/[id]/activity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), { params: { id: 'user-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest(), { params: { id: 'user-1' } })
    expect(res.status).toBe(403)
  })

  it('returns activity events list', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleEvents)

    const res = await GET(makeRequest(), { params: { id: 'user-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(2)
    expect(body.events[0].kind).toBe('order_placed')
  })

  it('passes user id to query', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    await GET(makeRequest('user-42'), { params: { id: 'user-42' } })

    const queryArgs = mockQueryMany.mock.calls[0][1] as any[]
    expect(queryArgs[0]).toBe('user-42')
  })

  it('respects limit param (clamped to 200)', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    await GET(makeRequest('user-1', { limit: '300' }), { params: { id: 'user-1' } })

    const queryArgs = mockQueryMany.mock.calls[0][1] as any[]
    // limit should be clamped to 200, passed as last arg
    expect(queryArgs[queryArgs.length - 1]).toBe(200)
  })

  it('defaults to limit 50 when not specified', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    await GET(makeRequest('user-1'), { params: { id: 'user-1' } })

    const queryArgs = mockQueryMany.mock.calls[0][1] as any[]
    expect(queryArgs[queryArgs.length - 1]).toBe(50)
  })

  it('includes before param as cursor when provided', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    const before = '2024-01-01T00:00:00Z'
    await GET(makeRequest('user-1', { before }), { params: { id: 'user-1' } })

    const queryArgs = mockQueryMany.mock.calls[0][1] as any[]
    expect(queryArgs).toContain(before)
  })

  it('returns empty events array when no activity', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeRequest(), { params: { id: 'user-1' } })
    const body = await res.json()
    expect(body.events).toEqual([])
  })
})
