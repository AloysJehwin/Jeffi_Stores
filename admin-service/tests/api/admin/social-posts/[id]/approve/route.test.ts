import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/social/posts', () => ({ decideApproval: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/social-posts/[id]/approve/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { decideApproval } from '@/lib/social/posts'

const req = () => new NextRequest('http://localhost/api/admin/social-posts/p1/approve', { method: 'POST' })
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', email: 'a@x.test', role: 'admin', scopes: [] } as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('POST /api/admin/social-posts/[id]/approve', () => {
  it('rejects unauthenticated and missing write scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('returns 403 without approval rights', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', [], 'social:approve')
    expect(decideApproval).not.toHaveBeenCalled()
  })

  it('returns 400 when approve is not a boolean', async () => {
    vi.mocked(readJson).mockResolvedValue({ approve: 'yes' })
    expect((await POST(req(), ctx)).status).toBe(400)
  })

  it('approves and records the decider', async () => {
    vi.mocked(readJson).mockResolvedValue({ approve: true })
    vi.mocked(decideApproval).mockResolvedValue(2 as any)
    const res = await POST(req(), ctx)
    expect(await res.json()).toEqual({ updated: 2 })
    expect(decideApproval).toHaveBeenCalledWith('t1', 'p1', true, 'a@x.test')
  })

  it('returns 409 when nothing is waiting', async () => {
    vi.mocked(readJson).mockResolvedValue({ approve: false })
    vi.mocked(decideApproval).mockResolvedValue(0 as any)
    expect((await POST(req(), ctx)).status).toBe(409)
  })
})
