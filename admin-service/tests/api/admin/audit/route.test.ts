import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
  authenticateServiceAccount: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

vi.mock('@/lib/shared/admin-audit', () => ({
  logAdminAudit: vi.fn(),
}))

// The list count is capped (lib/filters/run).
const { mockCappedCount } = vi.hoisted(() => ({ mockCappedCount: vi.fn() }))
vi.mock('@/lib/filters/run', () => ({ cappedCount: mockCappedCount }))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST } from '@admin/app/api/(admin)/admin/audit/route'
import { authenticateAdmin, authenticateServiceAccount } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { logAdminAudit } from '@/lib/shared/admin-audit'

const mockAuth = vi.mocked(authenticateAdmin)
const mockAuthSA = vi.mocked(authenticateServiceAccount)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const counted = (count: number) => mockCappedCount.mockResolvedValue({ count, capped: false })
const mockLogAudit = vi.mocked(logAdminAudit)

// ── Helpers ───────────────────────────────────────────────────────────────────

const superAdminPayload = {
  adminId: 'admin-1',
  username: 'superadmin',
  role: 'super_admin',
  scopes: ['audit:read', 'audit:write'],
}

const regularAdminPayload = {
  adminId: 'admin-2',
  username: 'regularadmin',
  role: 'admin',
  scopes: ['audit:read'],
}

const saPayload = {
  name: 'billing-service',
  allowed_scopes: ['audit:write'],
}

const saAuditScopePayload = {
  name: 'legacy-service',
  allowed_scopes: ['audit'],
}

const saNoScopePayload = {
  name: 'other-service',
  allowed_scopes: ['orders:read'],
}

function makeGetRequest(params?: Record<string, string>, headers?: Record<string, string>) {
  const url = new URL('http://localhost/api/admin/audit')
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: {
      cookie: 'admin_sid=valid-token',
      ...headers,
    },
  })
}

function makePostRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/audit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'admin_sid=valid-token',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function makePostRequestRawBody(rawBody: string, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/audit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: rawBody,
  })
}

const sampleEvents = [
  {
    id: 'evt-1',
    admin_id: 'admin-1',
    action: 'update',
    entity_type: 'product',
    entity_id: 'prod-1',
    summary: 'Updated product',
    diff: null,
    metadata: {},
    ip_address: '127.0.0.1',
    created_at: new Date().toISOString(),
    admin_first_name: 'Super',
    admin_last_name: 'Admin',
    admin_username: 'superadmin',
  },
]

const validPostBody = {
  action: 'update',
  entity_type: 'product',
  entity_id: 'prod-1',
  summary: 'Updated product price',
}

// ── GET Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/audit', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // GET never calls authenticateServiceAccount — default null for safety
    mockAuthSA.mockResolvedValue(null)
    counted(1)
    mockQueryMany.mockResolvedValue(sampleEvents)
  })

  it('returns 401 when authenticateAdmin returns null', async () => {
    mockAuth.mockResolvedValue(null)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when role is not super_admin and hasScope returns false', async () => {
    mockAuth.mockResolvedValue(regularAdminPayload)
    mockHasScope.mockReturnValue(false)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 200 when role is super_admin (via hasScope grant)', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockHasScope).toHaveBeenCalledWith('super_admin', superAdminPayload.scopes, 'audit:read')
    const body = await res.json()
    expect(body).toHaveProperty('events')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('pageSize')
  })

  it('returns 200 when role is not super_admin but hasScope returns true', async () => {
    mockAuth.mockResolvedValue(regularAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual(sampleEvents)
  })

  it('returns 200 with no filters — only the default 7-day window', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    // The window's start date, then LIMIT / OFFSET
    const [sql, vals] = mockQueryMany.mock.calls[0]
    expect(vals).toHaveLength(3)
    expect(sql).toContain('WHERE l.created_at >=')
    expect((await res.json()).window).toMatchObject({ days: 7 })
  })

  it('returns 200 with entity_type filter', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest({ entity_type: 'product' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const [sql, vals] = mockQueryMany.mock.calls[0]
    expect(vals).toContain('product')
    expect(sql).toContain('entity_type')
  })

  it('returns 200 with action filter', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest({ action: 'update' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const [sql, vals] = mockQueryMany.mock.calls[0]
    expect(vals).toContain('update')
    expect(sql).toContain('l.action')
  })

  it('returns 200 with admin (member name) filter', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest({ admin: 'Super Admin' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const [sql, vals] = mockQueryMany.mock.calls[0]
    expect(vals).toContain('Super Admin')
    expect(sql).toContain('admin_id')
  })

  it('returns 200 with all three filters applied', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest({ entity_type: 'product', action: 'update', admin: 'Super Admin' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const [sql, vals] = mockQueryMany.mock.calls[0]
    // window, three filters, LIMIT / OFFSET
    expect(vals).toHaveLength(6)
    expect(vals).toContain('product')
    expect(vals).toContain('update')
    expect(vals).toContain('Super Admin')
    expect(sql).toContain('WHERE')
  })

  it('applies pagination params — page=2, pageSize=100', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest({ page: '2', pageSize: '100' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(100)
    // rowVals should end with [100, 100] (pageSize=100, offset=(2-1)*100=100)
    const [, rowVals] = mockQueryMany.mock.calls[0]!
    const last2 = rowVals!.slice(-2)
    expect(last2).toEqual([100, 100])
  })

  it('clamps pageSize to maximum of 200', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest({ pageSize: '9999' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(200)
  })

  it('clamps pageSize to minimum of 10', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest({ pageSize: '1' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(10)
  })

  it('clamps page to minimum of 1', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makeGetRequest({ page: '-5' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(1)
  })

  it('returns total from the capped count', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    counted(42)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(42)
  })
})

describe('GET /api/admin/audit response contract', () => {
  const superAdmin = {
    adminId: 'admin-1',
    username: 'superadmin',
    role: 'super_admin',
    scopes: [],
  }

  const regularAdmin = {
    adminId: 'admin-2',
    username: 'regularadmin',
    role: 'admin',
    scopes: ['audit'],
  }

  function makeRequest(searchParams: Record<string, string> = {}) {
    const url = new URL('http://localhost/api/admin/audit')
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
    return new NextRequest(url.toString(), {
      method: 'GET',
      headers: { cookie: 'admin_sid=valid-token' },
    })
  }

  const sampleRows = [{ id: 'log-1', action: 'create', entity_type: 'product', summary: 'Created product' }]

  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when regular admin lacks audit scope', async () => {
    mockAuth.mockResolvedValue({ ...regularAdmin, scopes: [] })
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('allows super_admin (hasScope grants platform owner)', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    counted(1)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  it('allows regular admin with audit scope', async () => {
    mockAuth.mockResolvedValue(regularAdmin)
    mockHasScope.mockReturnValue(true)
    counted(1)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  it('returns paginated events on success', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    counted(5)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    const res = await GET(makeRequest({ page: '1', pageSize: '10' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual(sampleRows)
    expect(body.total).toBe(5)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(10)
  })

  it('applies entity_type filter', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    counted(2)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    await GET(makeRequest({ entity_type: 'product' }))
    expect(mockQueryMany.mock.calls[0][1]).toContain('product')
  })

  it('applies action filter', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    counted(2)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    await GET(makeRequest({ action: 'create' }))
    expect(mockQueryMany.mock.calls[0][1]).toContain('create')
  })

  it('applies admin filter', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    counted(2)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    await GET(makeRequest({ admin: 'Super Admin' }))
    expect(mockQueryMany.mock.calls[0][1]).toContain('Super Admin')
  })

  it('clamps page size to valid range', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    counted(0)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest({ page: '0', pageSize: '9999' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(200)
    expect(body.page).toBe(1)
  })

  it('returns empty events when no records', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockHasScope.mockReturnValue(true)
    counted(0)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual([])
    expect(body.total).toBe(0)
  })
})
