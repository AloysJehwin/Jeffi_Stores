import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/tenant-registry', () => ({ claimDueSocialPosts: vi.fn(), lookupTenantContextById: vi.fn(), updateSocialPost: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: vi.fn() }))
vi.mock('@/lib/social/publisher', () => ({ publishScheduledPost: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/publish-social-posts/route'
import { claimDueSocialPosts, lookupTenantContextById, updateSocialPost } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { publishScheduledPost } from '@/lib/social/publisher'

const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/publish-social-posts', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(claimDueSocialPosts).mockResolvedValue([])
  vi.mocked(runWithTenantContext).mockImplementation(async (_ctx: any, fn: any) => fn())
})

describe('GET /api/cron/publish-social-posts', () => {
  it('401 without the cron secret, with a wrong one, or with no secret configured, and does nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(claimDueSocialPosts).not.toHaveBeenCalled()
  })

  it('claims up to 20 due posts and reports none when nothing is due', async () => {
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, published: 0, total: 0, results: [] })
    expect(claimDueSocialPosts).toHaveBeenCalledWith(20)
    expect(publishScheduledPost).not.toHaveBeenCalled()
  })

  it('publishes a platform post (no tenant) directly', async () => {
    const post = { id: 'p1', tenant_id: null }
    vi.mocked(claimDueSocialPosts).mockResolvedValue([post] as any)
    vi.mocked(publishScheduledPost).mockResolvedValue({ ok: true } as any)
    const json = await (await run(OK)).json()
    expect(json).toEqual({ success: true, published: 1, total: 1, results: [{ id: 'p1', ok: true }] })
    expect(publishScheduledPost).toHaveBeenCalledWith(post)
    expect(lookupTenantContextById).not.toHaveBeenCalled()
    expect(runWithTenantContext).not.toHaveBeenCalled()
  })

  it("publishes a tenant's post inside that tenant's context and counts a failed publish", async () => {
    const ctx = { tenantId: 't1' }
    vi.mocked(claimDueSocialPosts).mockResolvedValue([{ id: 'p1', tenant_id: 't1' }, { id: 'p2', tenant_id: 't1' }] as any)
    vi.mocked(lookupTenantContextById).mockResolvedValue(ctx as any)
    vi.mocked(publishScheduledPost).mockResolvedValueOnce({ ok: true } as any).mockResolvedValueOnce({ ok: false, error: 'Instagram rejected it' } as any)
    const json = await (await run(OK)).json()
    expect(json).toMatchObject({ published: 1, total: 2 })
    expect(json.results).toEqual([{ id: 'p1', ok: true }, { id: 'p2', ok: false, error: 'Instagram rejected it' }])
    expect(lookupTenantContextById).toHaveBeenCalledWith('t1')
    expect(vi.mocked(runWithTenantContext).mock.calls[0][0]).toBe(ctx)
  })

  it('fails the post (not published) when its tenant is no longer active', async () => {
    vi.mocked(claimDueSocialPosts).mockResolvedValue([{ id: 'p1', tenant_id: 'gone' }] as any)
    vi.mocked(lookupTenantContextById).mockResolvedValue(null as any)
    const json = await (await run(OK)).json()
    expect(json).toMatchObject({ published: 0, total: 1, results: [{ id: 'p1', ok: false, error: 'tenant not active' }] })
    expect(updateSocialPost).toHaveBeenCalledWith('p1', { status: 'failed', lastError: 'tenant not active' })
    expect(publishScheduledPost).not.toHaveBeenCalled()
  })
})
