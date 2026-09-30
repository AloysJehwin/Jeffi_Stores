import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  withTransaction: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { PATCH } from '@/app/api/admin/cron/config/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { withTransaction } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockWithTransaction = vi.mocked(withTransaction)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['audit'],
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/admin/cron/config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid' },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/cron/config', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makeRequest({ jobId: 'cancel_stale_orders', enabled: true }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makeRequest({ jobId: 'cancel_stale_orders', enabled: true }))
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid job ID', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makeRequest({ jobId: 'nonexistent_job', enabled: true }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid job/i)
  })

  it('returns 400 when enabled is not boolean', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makeRequest({ jobId: 'cancel_stale_orders', enabled: 'yes' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/boolean/i)
  })

  it('updates job enabled=true successfully', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockWithTransaction.mockImplementation(async fn => {
      await fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } as any)
    })

    const res = await PATCH(makeRequest({ jobId: 'cancel_stale_orders', enabled: true }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('updates job enabled=false successfully', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockWithTransaction.mockImplementation(async fn => {
      const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 })
      await fn({ query: clientQuery } as any)
    })

    const res = await PATCH(makeRequest({ jobId: 'delhivery_sync', enabled: false }))
    expect(res.status).toBe(200)
  })

  it('returns 500 on DB error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockWithTransaction.mockRejectedValue(new Error('Transaction failed'))

    const res = await PATCH(makeRequest({ jobId: 'cancel_stale_orders', enabled: true }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/Transaction failed/i)
  })
})
