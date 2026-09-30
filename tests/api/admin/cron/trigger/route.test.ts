import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

// fetch is global in happy-dom; override per test via vi.stubGlobal

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/cron/trigger/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/cron/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.APP_URL = 'http://localhost:3000'
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
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
    const body = await res.json()
    expect(body.error).toMatch(/invalid jobId/i)
  })

  it('returns 503 when CRON_SECRET is not configured', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    delete process.env.CRON_SECRET

    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toMatch(/not configured/i)
  })

  it('returns 503 when APP_URL is not configured', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL

    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(503)
  })

  it('calls the job endpoint and returns ok + status', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', mockFetch)

    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/cron/cancel-stale-orders'),
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('returns 500 on fetch error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const res = await POST(makeRequest({ jobId: 'cancel_stale_orders' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/network error/i)
  })

  it('triggers delhivery_sync with POST method', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', mockFetch)

    await POST(makeRequest({ jobId: 'delhivery_sync' }))

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/delhivery/sync-statuses'),
      expect.objectContaining({ method: 'POST' })
    )
  })
})
