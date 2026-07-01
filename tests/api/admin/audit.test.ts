import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
  authenticateServiceAccount: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

vi.mock('@/lib/admin-audit', () => ({
  logAdminAudit: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/audit/route'
import { authenticateAdmin, authenticateServiceAccount } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryCount } from '@/lib/db'
import { logAdminAudit } from '@/lib/admin-audit'

const mockAuth = vi.mocked(authenticateAdmin)
const mockAuthSA = vi.mocked(authenticateServiceAccount)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)
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
      cookie: 'admin_token=valid-token',
      ...headers,
    },
  })
}

function makePostRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/audit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'admin_token=valid-token',
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
    mockQueryCount.mockResolvedValue(1)
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

  it('returns 200 when role is super_admin (bypasses scope check)', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    // hasScope should NOT be called for super_admin
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockHasScope).not.toHaveBeenCalled()
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

  it('returns 200 with no filters — no WHERE clause in query', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    // queryCount called with empty filterVals
    const [countSql, countVals] = mockQueryCount.mock.calls[0]
    expect(countVals).toHaveLength(0)
    expect(countSql).not.toContain('WHERE')
  })

  it('returns 200 with entity_type filter', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    const req = makeGetRequest({ entity_type: 'product' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const [countSql, countVals] = mockQueryCount.mock.calls[0]
    expect(countVals).toContain('product')
    expect(countSql).toContain('entity_type')
  })

  it('returns 200 with action filter', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    const req = makeGetRequest({ action: 'update' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const [countSql, countVals] = mockQueryCount.mock.calls[0]
    expect(countVals).toContain('update')
    expect(countSql).toContain('l.action')
  })

  it('returns 200 with admin_id filter', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    const req = makeGetRequest({ admin_id: 'admin-1' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const [countSql, countVals] = mockQueryCount.mock.calls[0]
    expect(countVals).toContain('admin-1')
    expect(countSql).toContain('admin_id')
  })

  it('returns 200 with all three filters applied', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    const req = makeGetRequest({ entity_type: 'product', action: 'update', admin_id: 'admin-1' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const [countSql, countVals] = mockQueryCount.mock.calls[0]
    expect(countVals).toHaveLength(3)
    expect(countVals).toContain('product')
    expect(countVals).toContain('update')
    expect(countVals).toContain('admin-1')
    expect(countSql).toContain('WHERE')
  })

  it('applies pagination params — page=2, pageSize=100', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    const req = makeGetRequest({ page: '2', pageSize: '100' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(100)
    // rowVals should end with [100, 100] (pageSize=100, offset=(2-1)*100=100)
    const [, rowVals] = mockQueryMany.mock.calls[0]
    const last2 = rowVals.slice(-2)
    expect(last2).toEqual([100, 100])
  })

  it('clamps pageSize to maximum of 200', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    const req = makeGetRequest({ pageSize: '9999' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(200)
  })

  it('clamps pageSize to minimum of 10', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    const req = makeGetRequest({ pageSize: '1' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(10)
  })

  it('clamps page to minimum of 1', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    const req = makeGetRequest({ page: '-5' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(1)
  })

  it('returns total from queryCount', async () => {
    mockAuth.mockResolvedValue(superAdminPayload)
    mockQueryCount.mockResolvedValue(42)
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(42)
  })
})

// ── POST Tests ────────────────────────────────────────────────────────────────

describe('POST /api/admin/audit', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuthSA.mockResolvedValue(null)
    mockAuth.mockResolvedValue(null)
    mockLogAudit.mockResolvedValue(undefined as any)
    // Clear CRON_SECRET env
    delete process.env.CRON_SECRET
  })

  it('returns 401 when sa=null, cronOk=false, admin=null', async () => {
    mockAuthSA.mockResolvedValue(null)
    mockAuth.mockResolvedValue(null)
    const req = makePostRequest(validPostBody)
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when sa has no audit:write or audit scope', async () => {
    mockAuthSA.mockResolvedValue(saNoScopePayload as any)
    const req = makePostRequest(validPostBody)
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 403 when admin has no audit:write scope', async () => {
    mockAuthSA.mockResolvedValue(null)
    const adminNoScope = { ...regularAdminPayload, scopes: ['orders:read'] }
    mockAuth.mockResolvedValue(adminNoScope)
    mockHasScope.mockReturnValue(false)
    const req = makePostRequest(validPostBody)
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 400 on invalid JSON body', async () => {
    mockAuthSA.mockResolvedValue(saPayload as any)
    const req = makePostRequestRawBody('not-valid-json{{{')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid json/i)
  })

  it('returns 400 when action is missing', async () => {
    mockAuthSA.mockResolvedValue(saPayload as any)
    const req = makePostRequest({ entity_type: 'product', summary: 'Test' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/action/i)
  })

  it('returns 400 when action is invalid', async () => {
    mockAuthSA.mockResolvedValue(saPayload as any)
    const req = makePostRequest({ action: 'invalid_action', entity_type: 'product', summary: 'Test' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/action/i)
  })

  it('returns 400 when entity_type is missing', async () => {
    mockAuthSA.mockResolvedValue(saPayload as any)
    const req = makePostRequest({ action: 'update', summary: 'Test' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/entity_type/i)
  })

  it('returns 400 when summary is missing', async () => {
    mockAuthSA.mockResolvedValue(saPayload as any)
    const req = makePostRequest({ action: 'update', entity_type: 'product' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/summary/i)
  })

  it('returns 200 via sa with audit:write scope', async () => {
    mockAuthSA.mockResolvedValue(saPayload as any)
    const req = makePostRequest(validPostBody)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 200 via sa with audit scope (not audit:write)', async () => {
    mockAuthSA.mockResolvedValue(saAuditScopePayload as any)
    const req = makePostRequest(validPostBody)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 200 via cron secret', async () => {
    process.env.CRON_SECRET = 'my-secret'
    // authenticateServiceAccount returns null, cron auth passes
    mockAuthSA.mockResolvedValue(null)
    const req = makePostRequest(validPostBody, { authorization: 'Bearer my-secret' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // admin was never called since cronOk=true
    expect(mockAuth).not.toHaveBeenCalled()
  })

  it('returns 200 via admin session with audit:write scope', async () => {
    mockAuthSA.mockResolvedValue(null)
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makePostRequest(validPostBody)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('logAdminAudit called with service_account metadata when sa auth', async () => {
    mockAuthSA.mockResolvedValue(saPayload as any)
    const req = makePostRequest({ ...validPostBody, metadata: { custom: 'value' } })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockLogAudit).toHaveBeenCalledOnce()
    const callArg = mockLogAudit.mock.calls[0][0]
    expect(callArg.metadata).toMatchObject({
      custom: 'value',
      service_account: 'billing-service',
    })
    expect(callArg.metadata).not.toHaveProperty('source')
    expect(callArg.adminId).toBeNull()
  })

  it('logAdminAudit called with source:cron metadata when cron auth', async () => {
    process.env.CRON_SECRET = 'cron-secret-xyz'
    mockAuthSA.mockResolvedValue(null)
    const req = makePostRequest(validPostBody, { authorization: 'Bearer cron-secret-xyz' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockLogAudit).toHaveBeenCalledOnce()
    const callArg = mockLogAudit.mock.calls[0][0]
    expect(callArg.metadata).toMatchObject({ source: 'cron' })
    expect(callArg.metadata).not.toHaveProperty('service_account')
    expect(callArg.adminId).toBeNull()
  })

  it('logAdminAudit called with adminId when admin auth', async () => {
    mockAuthSA.mockResolvedValue(null)
    mockAuth.mockResolvedValue(superAdminPayload)
    mockHasScope.mockReturnValue(true)
    const req = makePostRequest(validPostBody)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const callArg = mockLogAudit.mock.calls[0][0]
    expect(callArg.adminId).toBe('admin-1')
    expect(callArg.metadata).not.toHaveProperty('service_account')
    expect(callArg.metadata).not.toHaveProperty('source')
  })

  it('cron secret mismatch still requires other auth', async () => {
    process.env.CRON_SECRET = 'real-secret'
    mockAuthSA.mockResolvedValue(null)
    mockAuth.mockResolvedValue(null)
    // Wrong secret
    const req = makePostRequest(validPostBody, { authorization: 'Bearer wrong-secret' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('CRON_SECRET env not set — bearer token does not grant cron access', async () => {
    // CRON_SECRET is already deleted in beforeEach
    mockAuthSA.mockResolvedValue(null)
    mockAuth.mockResolvedValue(null)
    const req = makePostRequest(validPostBody, { authorization: 'Bearer any-token' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('forwards entity_id, diff, metadata to logAdminAudit', async () => {
    mockAuthSA.mockResolvedValue(saPayload as any)
    const fullBody = {
      action: 'create',
      entity_type: 'product',
      entity_id: 'prod-99',
      summary: 'Created product',
      diff: { price: { from: 100, to: 200 } },
      metadata: { reason: 'bulk-import' },
    }
    const req = makePostRequest(fullBody)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const callArg = mockLogAudit.mock.calls[0][0]
    expect(callArg.action).toBe('create')
    expect(callArg.entityType).toBe('product')
    expect(callArg.entityId).toBe('prod-99')
    expect(callArg.summary).toBe('Created product')
    expect(callArg.diff).toEqual({ price: { from: 100, to: 200 } })
  })

  it('uses null for entity_id and diff when omitted', async () => {
    mockAuthSA.mockResolvedValue(saPayload as any)
    const bodyWithoutOptionals = { action: 'update', entity_type: 'product', summary: 'No extras' }
    const req = makePostRequest(bodyWithoutOptionals)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const callArg = mockLogAudit.mock.calls[0][0]
    expect(callArg.entityId).toBeNull()
    expect(callArg.diff).toBeNull()
  })
})
