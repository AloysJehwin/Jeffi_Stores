import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/social/data', () => ({ listPosts: vi.fn() }))
vi.mock('@/lib/social/posts', async (orig) => ({ ...(await orig<any>()), composePosts: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/social-posts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { listPosts } from '@/lib/social/data'
import { composePosts } from '@/lib/social/posts'

const ADMIN = { adminId: 'a1', email: 'a@x.test', role: 'admin', scopes: ['social:write'] }
const req = (method: string, qs = '') => new NextRequest(`http://localhost/api/admin/social-posts${qs}`, { method })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('GET /api/admin/social-posts', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await GET(req('GET'))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await GET(req('GET'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:read')
    expect(listPosts).not.toHaveBeenCalled()
  })

  it('lists the tenant queue for the date range', async () => {
    vi.mocked(listPosts).mockResolvedValue([{ id: 'p1' }] as any)
    const res = await GET(req('GET', '?from=2026-01-01&to=2026-02-01'))
    expect(await res.json()).toEqual({ posts: [{ id: 'p1' }] })
    expect(listPosts).toHaveBeenCalledWith('t1', { from: '2026-01-01', to: '2026-02-01' })
  })

  it('propagates a storage failure', async () => {
    vi.mocked(listPosts).mockRejectedValue(new Error('db down'))
    await expect(GET(req('GET'))).rejects.toThrow('db down')
  })
})

describe('POST /api/admin/social-posts', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req('POST'))).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req('POST'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('returns 400 for an invalid post', async () => {
    vi.mocked(readJson).mockResolvedValue({ platforms: [] })
    const res = await POST(req('POST'))
    expect(res.status).toBe(400)
    expect(composePosts).not.toHaveBeenCalled()
  })

  it('queues for approval when the admin cannot approve', async () => {
    vi.mocked(readJson).mockResolvedValue({ platforms: ['fb'], caption: 'hi' })
    vi.mocked(hasScope).mockReturnValue(false)
    vi.mocked(composePosts).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as any)
    const res = await POST(req('POST'))
    expect(await res.json()).toEqual({ posts: [{ id: 'p1' }, { id: 'p2' }], post: { id: 'p1' } })
    expect(composePosts).toHaveBeenCalledWith('t1', expect.objectContaining({ caption: 'hi' }), { approval: true, createdBy: 'a@x.test' })
  })

  it('schedules directly when the admin can approve', async () => {
    vi.mocked(readJson).mockResolvedValue({ platforms: ['fb'], caption: 'hi' })
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(composePosts).mockResolvedValue([{ id: 'p1' }] as any)
    await POST(req('POST'))
    expect(composePosts).toHaveBeenCalledWith('t1', expect.anything(), { approval: false, createdBy: 'a@x.test' })
  })

  it('propagates a compose failure', async () => {
    vi.mocked(readJson).mockResolvedValue({ platforms: ['fb'] })
    vi.mocked(composePosts).mockRejectedValue(new Error('queue fail'))
    await expect(POST(req('POST'))).rejects.toThrow('queue fail')
  })
})
