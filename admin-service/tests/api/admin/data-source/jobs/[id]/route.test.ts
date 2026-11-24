import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/import/jobs', () => ({ getImportJob: vi.fn(), resolveImportTenantId: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/data-source/jobs/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getImportJob, resolveImportTenantId } from '@/lib/import/jobs'

const req = () => new NextRequest('http://localhost/api/admin/data-source/jobs/j1')
const ctx = { params: Promise.resolve({ id: 'j1' }) }
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveImportTenantId).mockResolvedValue('t1')
})

describe('GET /api/admin/data-source/jobs/[id]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req(), ctx)).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req(), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:read')
    expect(getImportJob).not.toHaveBeenCalled()
  })

  it('returns 404 when the job is not in this tenant', async () => {
    vi.mocked(getImportJob).mockResolvedValue(null as any)
    expect((await GET(req(), ctx)).status).toBe(404)
    expect(getImportJob).toHaveBeenCalledWith('j1', 't1')
  })

  it('returns the job', async () => {
    vi.mocked(getImportJob).mockResolvedValue({ id: 'j1', status: 'done' } as any)
    expect(await (await GET(req(), ctx)).json()).toEqual({ job: { id: 'j1', status: 'done' } })
  })
})
