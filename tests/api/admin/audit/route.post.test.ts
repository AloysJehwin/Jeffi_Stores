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
