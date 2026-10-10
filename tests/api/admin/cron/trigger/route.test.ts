import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({
  resolveTenant: vi.fn(),
  // Run the callback immediately — the tests don't need real ALS.
  runWithTenantContext: vi.fn((_ctx: unknown, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('@/lib/auth/plan-gate', () => ({ getTenantPlan: vi.fn() }))
vi.mock('@/lib/shared/cron-record', () => ({ recordCronRun: vi.fn().mockResolvedValue(undefined) }))

// Job route modules invoked in-process by the trigger.
const cancelGet = vi.fn()
const delhiveryPost = vi.fn()
vi.mock('@/app/api/(internal)/cron/cancel-stale-orders/route', () => ({ GET: cancelGet }))
vi.mock('@/app/api/(admin)/admin/delhivery/sync-statuses/route', () => ({ POST: delhiveryPost }))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/(admin)/admin/cron/trigger/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { recordCronRun } from '@/lib/shared/cron-record'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockResolveTenant = vi.mocked(resolveTenant)
const mockRecord = vi.mocked(recordCronRun)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['audit'],
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/admin/cron/trigger', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid' },
    body: JSON.stringify(body),
  })
}

const okResponse = () => new Response(JSON.stringify({ ok: true }), { status: 200 })

describe('POST /api/admin/cron/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    // Default: flagship (no tenant) — skips the plan gate.
    mockResolveTenant.mockResolvedValue(null)
    cancelGet.mockResolvedValue(okResponse())
    delhiveryPost.mockResolvedValue(okResponse())
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid jobId', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ jobId: 'nonexistent_job' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid jobId/i)
  })

  it('returns 503 when CRON_SECRET is not configured', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    delete process.env.CRON_SECRET
    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/not configured/i)
  })

  it('runs the job handler in-process and records the run', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)

    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(cancelGet).toHaveBeenCalledOnce()
    expect(mockRecord).toHaveBeenCalledWith('cancel_stale_orders', true, undefined, expect.anything())
  })

  it('records a failed run when the job handler throws', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    cancelGet.mockRejectedValue(new Error('boom'))

    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(false)
    expect(mockRecord).toHaveBeenCalledWith('cancel_stale_orders', false, 'boom', undefined)
  })

  it('invokes the POST handler for delhivery_sync', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)

    await POST(makeRequest({ jobId: 'delhivery_sync' }))
    expect(delhiveryPost).toHaveBeenCalledOnce()
  })
})
