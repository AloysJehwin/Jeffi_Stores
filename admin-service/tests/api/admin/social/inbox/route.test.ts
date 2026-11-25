import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/social/data', () => ({ listInbox: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/social/inbox/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { listInbox } from '@/lib/social/data'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/social/inbox${qs}`)
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
  vi.mocked(listInbox).mockResolvedValue([{ id: 'i1' }] as any)
})

describe('GET /api/admin/social/inbox', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req())).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:read')
  })

  it('defaults to open items', async () => {
    expect(await (await GET(req())).json()).toEqual({ items: [{ id: 'i1' }] })
    expect(listInbox).toHaveBeenCalledWith('t1', 'open')
  })

  it('honours filter=all and treats anything else as open', async () => {
    await GET(req('?filter=all'))
    expect(listInbox).toHaveBeenLastCalledWith('t1', 'all')
    await GET(req('?filter=junk'))
    expect(listInbox).toHaveBeenLastCalledWith('t1', 'open')
  })
})
