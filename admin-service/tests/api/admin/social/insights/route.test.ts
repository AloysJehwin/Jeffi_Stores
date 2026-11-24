import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/social/data', () => ({ loadInsights: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/social/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { loadInsights } from '@/lib/social/data'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/social/insights${qs}`)
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
  vi.mocked(loadInsights).mockResolvedValue({ reach: 5 } as any)
})

describe('GET /api/admin/social/insights', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:read')
  })

  it('defaults to 30 days and returns the insights', async () => {
    expect(await (await GET(req())).json()).toEqual({ reach: 5 })
    expect(loadInsights).toHaveBeenCalledWith('t1', 30)
  })

  it('clamps days to 1..90', async () => {
    await GET(req('?days=500'))
    expect(loadInsights).toHaveBeenLastCalledWith('t1', 90)
    await GET(req('?days=7'))
    expect(loadInsights).toHaveBeenLastCalledWith('t1', 7)
    await GET(req('?days=-4'))
    expect(loadInsights).toHaveBeenLastCalledWith('t1', 1)
  })
})
