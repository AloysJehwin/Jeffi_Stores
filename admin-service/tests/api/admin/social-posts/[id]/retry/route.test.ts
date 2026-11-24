import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/social/posts', () => ({ retryPost: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/social-posts/[id]/retry/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { retryPost } from '@/lib/social/posts'

const req = () => new NextRequest('http://localhost/api/admin/social-posts/p1/retry', { method: 'POST' })
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('POST /api/admin/social-posts/[id]/retry', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
    expect(retryPost).not.toHaveBeenCalled()
  })

  it('re-queues a failed post', async () => {
    vi.mocked(retryPost).mockResolvedValue(true as any)
    const res = await POST(req(), ctx)
    expect(await res.json()).toEqual({ ok: true })
    expect(retryPost).toHaveBeenCalledWith('t1', 'p1')
  })

  it('returns 409 when the post cannot be retried', async () => {
    vi.mocked(retryPost).mockResolvedValue(false as any)
    expect((await POST(req(), ctx)).status).toBe(409)
  })
})
