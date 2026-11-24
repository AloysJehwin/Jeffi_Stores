import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/channels/route', () => ({ readJson: vi.fn() }))
vi.mock('@/lib/social/jobs', () => ({ replyToInboxItem: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/social/inbox/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { replyToInboxItem } from '@/lib/social/jobs'

const req = () => new NextRequest('http://localhost/api/admin/social/inbox/i1', { method: 'POST' })
const ctx = { params: Promise.resolve({ id: 'i1' }) }
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', email: 'a@x.test' } as any)
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
})

describe('POST /api/admin/social/inbox/[id]', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(requireAdminScope).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'social:write')
  })

  it('returns 400 for empty or oversized replies', async () => {
    vi.mocked(readJson).mockResolvedValueOnce({ text: '  ' })
    expect((await POST(req(), ctx)).status).toBe(400)
    vi.mocked(readJson).mockResolvedValueOnce({ text: 'a'.repeat(4001) })
    expect((await POST(req(), ctx)).status).toBe(400)
    expect(replyToInboxItem).not.toHaveBeenCalled()
  })

  it('posts the reply on the network', async () => {
    vi.mocked(readJson).mockResolvedValue({ text: ' thanks ' })
    vi.mocked(replyToInboxItem).mockResolvedValue(undefined as any)
    expect(await (await POST(req(), ctx)).json()).toEqual({ ok: true })
    expect(replyToInboxItem).toHaveBeenCalledWith('t1', 'i1', 'thanks', 'a@x.test')
  })

  it('uses the error status when the network refuses, else 502', async () => {
    vi.mocked(readJson).mockResolvedValue({ text: 'hi' })
    vi.mocked(replyToInboxItem).mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }))
    expect((await POST(req(), ctx)).status).toBe(404)
    vi.mocked(replyToInboxItem).mockRejectedValueOnce(new Error('boom'))
    const res = await POST(req(), ctx)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('boom')
  })
})
