import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/import/jobs', () => ({ pageImportJobs: vi.fn(), resolveImportTenantId: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/data-source/jobs/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { pageImportJobs, resolveImportTenantId } from '@/lib/import/jobs'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/data-source/jobs${qs}`)
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveImportTenantId).mockResolvedValue('t1')
  vi.mocked(pageImportJobs).mockResolvedValue({ jobs: [{ id: 'j1' }], total: 1 } as any)
})

describe('GET /api/admin/data-source/jobs', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:read')
  })

  it('pages with defaults', async () => {
    expect(await (await GET(req())).json()).toEqual({ jobs: [{ id: 'j1' }], total: 1 })
    expect(pageImportJobs).toHaveBeenCalledWith('t1', { limit: 20, offset: 0, status: 'all', source: 'all' })
  })

  it('passes valid filters and ignores invalid ones', async () => {
    await GET(req('?limit=5&offset=10&status=failed&source=google_sheet'))
    expect(pageImportJobs).toHaveBeenLastCalledWith('t1', { limit: 5, offset: 10, status: 'failed', source: 'google_sheet' })
    await GET(req('?status=bogus&source=other'))
    expect(pageImportJobs).toHaveBeenLastCalledWith('t1', expect.objectContaining({ status: 'all', source: 'all' }))
  })

  it('returns 500 when the history cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(pageImportJobs).mockRejectedValue(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
