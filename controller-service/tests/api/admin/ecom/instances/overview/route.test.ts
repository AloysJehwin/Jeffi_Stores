import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const query = vi.fn()
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { GET } from '@controller/app/api/(admin)/admin/ecom/instances/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/ecom/instances/overview${qs}`)
const GB = 1024 ** 3

function rows(sql: string) {
  if (sql.includes('AS live_without_db'))
    return [
      {
        stores: 3,
        provisioned: 2,
        live_without_db: 0,
        running: 2,
        stopped: 1,
        provisioning: 1,
        suspended: 0,
        dedicated: 1,
        pooled: 1,
      },
    ]
  if (sql.includes('AS avg_minutes_prev'))
    return [
      {
        started: 2,
        started_prev: 1,
        done: 1,
        done_prev: 1,
        failed: 1,
        failed_prev: 0,
        avg_minutes: '12.5',
        avg_minutes_prev: '10',
        open: 1,
        stuck: 1,
      },
    ]
  if (sql.includes('json_agg'))
    return [
      {
        latest: [
          { sha: 'abc1234', status: 'success' },
          { sha: 'abc1234', status: 'success' },
          { sha: 'def5678', status: 'failed' },
        ],
        runs: 3,
        failed: 1,
        failed_prev: 0,
      },
    ]
  if (sql.includes('AS quota'))
    return [
      { id: 't1', name: 'Acme', plan: 'basic', used: String(9 * GB), file_count: 10, quota: String(10 * GB) },
      { id: 't2', name: 'Beta', plan: 'pro', used: '0', file_count: 0, quota: String(200 * GB) },
    ]
  return []
}

describe('GET /api/admin/ecom/instances/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    query.mockImplementation(async (sql: string) => ({ rows: rows(sql) }))
  })

  it('is gated on ecom_instances:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    )
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_instances:read')
    expect(query).not.toHaveBeenCalled()
  })

  it('returns fleet, provisioning, release drift and storage', async () => {
    const j = await (await GET(req('?from=2026-10-01&to=2026-10-10'))).json()
    expect(j.snapshot).toMatchObject({ stores: 3, provisioned: 2, stopped: 1, stuck_jobs: 1 })
    expect(j.current).toMatchObject({
      started: 2,
      failed: 1,
      success_rate: 0.5,
      avg_minutes: 12.5,
      migration_failures: 1,
    })
    expect(j.deltas.avg_minutes).toBe(0.25)
    expect(j.releases).toMatchObject({ head: 'abc1234', behind: 1, failed_latest: 1 })
    expect(j.storage).toMatchObject({ near_quota: 1, used_bytes: 9 * GB })
    expect(j.storage.top.map((x: any) => x.id)).toEqual(['t1'])
  })

  it('reports a database error as 500', async () => {
    query.mockRejectedValue(new Error('boom'))
    expect((await GET(req())).status).toBe(500)
  })
})
