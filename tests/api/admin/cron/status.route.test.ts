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
  query: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/cron/status/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['audit'],
}

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/cron/status', {
    method: 'GET',
    headers: { cookie: 'admin_token=valid' },
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/cron/status', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns all 6 jobs with default state when no settings exist', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jobs).toHaveLength(6)
    for (const job of body.jobs) {
      expect(job.enabled).toBe(true)
      expect(job.lastRun).toBeNull()
      expect(job.log).toEqual([])
    }
  })

  it('reflects enabled=false from settings', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({
      rows: [{ key: 'cron_enabled_delhivery_sync', value: 'false' }],
      rowCount: 1,
    } as any)

    const res = await GET(makeRequest())
    const body = await res.json()
    const delJob = body.jobs.find((j: any) => j.id === 'delhivery_sync')
    expect(delJob.enabled).toBe(false)
  })

  it('parses cron log JSON from settings', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const logEntry = [{ t: '2024-01-01T00:00:00Z', ok: true }]
    mockQuery.mockResolvedValue({
      rows: [{ key: 'cron_log_cancel_stale_orders', value: JSON.stringify(logEntry) }],
      rowCount: 1,
    } as any)

    const res = await GET(makeRequest())
    const body = await res.json()
    const job = body.jobs.find((j: any) => j.id === 'cancel_stale_orders')
    expect(job.log).toEqual(logEntry)
  })

  it('handles malformed log JSON gracefully (defaults to [])', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({
      rows: [{ key: 'cron_log_run_campaigns', value: 'not-valid-json' }],
      rowCount: 1,
    } as any)

    const res = await GET(makeRequest())
    const body = await res.json()
    const job = body.jobs.find((j: any) => j.id === 'run_campaigns')
    expect(job.log).toEqual([])
  })

  it('returns 500 on DB error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockRejectedValue(new Error('DB error'))

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/DB error/i)
  })
})
