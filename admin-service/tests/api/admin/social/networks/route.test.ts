import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/social/data', () => ({ listConnections: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/social/networks/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { listConnections } from '@/lib/social/data'

const req = () => new NextRequest('http://localhost/api/admin/social/networks')
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('GET /api/admin/social/networks', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:read')
  })

  it('lists the tenant connections', async () => {
    vi.mocked(listConnections).mockResolvedValue([{ network: 'x' }] as any)
    expect(await (await GET(req())).json()).toEqual({ networks: [{ network: 'x' }] })
    expect(listConnections).toHaveBeenCalledWith('t1')
  })

  it('propagates a storage failure', async () => {
    vi.mocked(listConnections).mockRejectedValue(new Error('db'))
    await expect(GET(req())).rejects.toThrow('db')
  })
})
