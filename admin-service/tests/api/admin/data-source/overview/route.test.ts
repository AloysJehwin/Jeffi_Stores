import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/import/jobs', () => ({
  failStaleImportJobs: vi.fn(),
  getGsheetStatus: vi.fn(),
  getImportStats: vi.fn(),
  resolveImportTenantId: vi.fn(),
}))

import { GET } from '@admin/app/api/(admin)/admin/data-source/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { failStaleImportJobs, getGsheetStatus, getImportStats, resolveImportTenantId } from '@/lib/import/jobs'

const req = () => new NextRequest('http://localhost/api/admin/data-source/overview')
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveImportTenantId).mockResolvedValue('t1')
  vi.mocked(failStaleImportJobs).mockResolvedValue(2 as any)
  vi.mocked(getImportStats).mockResolvedValue({ imported: 5 } as any)
  vi.mocked(getGsheetStatus).mockResolvedValue({ connected: false } as any)
  vi.mocked(queryOne).mockResolvedValue({ total: 9 } as any)
})

describe('GET /api/admin/data-source/overview', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:read')
  })

  it('resets stale jobs and returns stats, sheet status and catalogue counts', async () => {
    expect(await (await GET(req())).json()).toEqual({ stats: { imported: 5 }, gsheet: { connected: false }, catalog: { total: 9 }, reset: 2 })
    expect(failStaleImportJobs).toHaveBeenCalledWith('t1')
    expect(getImportStats).toHaveBeenCalledWith('t1', 30)
  })

  it('degrades to a null catalogue and zero resets when those queries fail', async () => {
    vi.mocked(failStaleImportJobs).mockRejectedValue(new Error('x'))
    vi.mocked(queryOne).mockRejectedValue(new Error('y'))
    const body = await (await GET(req())).json()
    expect(body.catalog).toBeNull()
    expect(body.reset).toBe(0)
  })

  it('returns 500 when the stats cannot be loaded', async () => {
    vi.mocked(getImportStats).mockRejectedValue(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
