import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/social/posts', async (orig) => ({ ...(await orig<any>()), editPost: vi.fn(), cancelPost: vi.fn() }))

import { PATCH, DELETE } from '@admin/app/api/(admin)/admin/social-posts/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { editPost, cancelPost } from '@/lib/social/posts'

const req = (method: string) => new NextRequest('http://localhost/api/admin/social-posts/p1', { method })
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('PATCH /api/admin/social-posts/[id]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('returns 400 for an invalid edit', async () => {
    vi.mocked(readJson).mockResolvedValue({ status: 'published' })
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(400)
    expect(editPost).not.toHaveBeenCalled()
  })

  it('edits the post', async () => {
    vi.mocked(readJson).mockResolvedValue({ caption: 'new' })
    vi.mocked(editPost).mockResolvedValue({ id: 'p1', caption: 'new' } as any)
    const res = await PATCH(req('PATCH'), ctx)
    expect(await res.json()).toEqual({ post: { id: 'p1', caption: 'new' } })
    expect(editPost).toHaveBeenCalledWith('t1', 'p1', expect.objectContaining({ caption: 'new' }))
  })

  it('returns 409 when the post is no longer editable', async () => {
    vi.mocked(readJson).mockResolvedValue({ caption: 'new' })
    vi.mocked(editPost).mockResolvedValue(null as any)
    expect((await PATCH(req('PATCH'), ctx)).status).toBe(409)
  })
})

describe('DELETE /api/admin/social-posts/[id]', () => {
  it('rejects unauthenticated', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(401)
    expect(cancelPost).not.toHaveBeenCalled()
  })

  it('cancels the post', async () => {
    vi.mocked(cancelPost).mockResolvedValue(true as any)
    const res = await DELETE(req('DELETE'), ctx)
    expect(await res.json()).toEqual({ ok: true })
    expect(cancelPost).toHaveBeenCalledWith('t1', 'p1')
  })

  it('returns 409 when it cannot be cancelled', async () => {
    vi.mocked(cancelPost).mockResolvedValue(false as any)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(409)
  })
})
