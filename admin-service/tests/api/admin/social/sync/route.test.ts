import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/social/jobs', () => ({ refreshSocialInsights: vi.fn(), syncSocialInbox: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/social/sync/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { refreshSocialInsights, syncSocialInbox } from '@/lib/social/jobs'

const req = () => new NextRequest('http://localhost/api/admin/social/sync', { method: 'POST' })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('POST /api/admin/social/sync', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
    expect(refreshSocialInsights).not.toHaveBeenCalled()
  })

  it('refreshes insights and syncs the inbox for the tenant', async () => {
    vi.mocked(refreshSocialInsights).mockResolvedValue({ rows: 3 } as any)
    vi.mocked(syncSocialInbox).mockResolvedValue({ items: 2 } as any)
    expect(await (await POST(req())).json()).toEqual({ insights: { rows: 3 }, inbox: { items: 2 } })
    expect(refreshSocialInsights).toHaveBeenCalledWith('t1')
    expect(syncSocialInbox).toHaveBeenCalledWith('t1')
  })

  it('propagates a provider failure', async () => {
    vi.mocked(refreshSocialInsights).mockRejectedValue(new Error('api'))
    vi.mocked(syncSocialInbox).mockResolvedValue({} as any)
    await expect(POST(req())).rejects.toThrow('api')
  })
})
