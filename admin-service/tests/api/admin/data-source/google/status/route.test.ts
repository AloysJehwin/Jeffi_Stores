import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/import/jobs', () => ({ resolveImportTenantId: vi.fn(), getGsheetStatus: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/data-source/google/status/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveImportTenantId, getGsheetStatus } from '@/lib/import/jobs'

const req = () => new NextRequest('http://localhost/api/admin/data-source/google/status')
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveImportTenantId).mockResolvedValue('t1')
})

describe('GET /api/admin/data-source/google/status', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'products:read')
    expect(getGsheetStatus).not.toHaveBeenCalled()
  })

  it('returns the sheet sync status for the tenant', async () => {
    vi.mocked(getGsheetStatus).mockResolvedValue({ connected: true, spreadsheetId: 's1' } as any)
    expect(await (await GET(req())).json()).toEqual({ connected: true, spreadsheetId: 's1' })
    expect(getGsheetStatus).toHaveBeenCalledWith('t1')
  })

  it('propagates a storage failure', async () => {
    vi.mocked(getGsheetStatus).mockRejectedValue(new Error('db'))
    await expect(GET(req())).rejects.toThrow('db')
  })
})
