import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/social/publisher', () => ({ publishScheduledPost: vi.fn() }))
vi.mock('@/lib/social/posts', () => ({ claimPostNow: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/social-posts/[id]/publish/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { publishScheduledPost } from '@/lib/social/publisher'
import { claimPostNow } from '@/lib/social/posts'

const req = () => new NextRequest('http://localhost/api/admin/social-posts/p1/publish', { method: 'POST' })
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('POST /api/admin/social-posts/[id]/publish', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
    expect(claimPostNow).not.toHaveBeenCalled()
  })

  it('returns 409 when the post cannot be claimed', async () => {
    vi.mocked(claimPostNow).mockResolvedValue(null as any)
    expect((await POST(req(), ctx)).status).toBe(409)
    expect(publishScheduledPost).not.toHaveBeenCalled()
  })

  it('claims then publishes the post', async () => {
    const post = { id: 'p1' }
    vi.mocked(claimPostNow).mockResolvedValue(post as any)
    vi.mocked(publishScheduledPost).mockResolvedValue({ ok: true, url: 'u' } as any)
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, url: 'u' })
    expect(claimPostNow).toHaveBeenCalledWith('t1', 'p1')
    expect(publishScheduledPost).toHaveBeenCalledWith(post)
  })

  it('returns 502 when the network refuses', async () => {
    vi.mocked(claimPostNow).mockResolvedValue({ id: 'p1' } as any)
    vi.mocked(publishScheduledPost).mockResolvedValue({ ok: false, error: 'boom' } as any)
    const res = await POST(req(), ctx)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('boom')
  })
})
