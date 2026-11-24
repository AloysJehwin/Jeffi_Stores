import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@jeffi/draft-locks', () => ({
  DRAFT_RESOURCES: { product: { readScope: 'products:read' } },
  heartbeat: vi.fn(),
  isDraftResourceType: vi.fn((t: string) => t === 'product'),
  viewers: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({ getDraftLockState: vi.fn() }))
vi.mock('@/lib/admin/draft-lock-events', () => ({ publishLockEvent: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/draft-locks/presence/route'
import { heartbeat, viewers } from '@jeffi/draft-locks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getDraftLockState } from '@/lib/admin/draft-locks'
import { publishLockEvent } from '@/lib/admin/draft-lock-events'

const ID = '11111111-1111-4111-8111-111111111111'
const req = (body: unknown) => new NextRequest('http://localhost/api/admin/draft-locks/presence', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const good = { resourceType: 'product', resourceId: ID, tabId: 'tab-1' }

describe('POST /api/admin/draft-locks/presence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(heartbeat).mockResolvedValue({ changed: false } as any)
    vi.mocked(viewers).mockResolvedValue([{ adminId: 'a1' }] as any)
    vi.mocked(getDraftLockState).mockResolvedValue({ draftExists: true } as any)
  })

  it('401s without a session (passive)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(good))).status).toBe(401)
    expect(authenticateAdmin).toHaveBeenCalledWith(expect.anything(), { passive: true })
  })

  it('400s on invalid json, type, id or tab id', async () => {
    expect((await POST(req('nope'))).status).toBe(400)
    expect((await POST(req({ ...good, resourceType: 'x' }))).status).toBe(400)
    expect((await POST(req({ ...good, resourceId: 'x' }))).status).toBe(400)
    expect((await POST(req({ ...good, tabId: 'a' }))).status).toBe(400)
    expect(heartbeat).not.toHaveBeenCalled()
  })

  it('403s without the read scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req(good))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('manager', [], 'products:read')
  })

  it('records the heartbeat and returns state with viewers', async () => {
    const res = await POST(req({ ...good, mode: 'edit' }))
    expect(await res.json()).toEqual({ draftExists: true, me: 'a1', viewers: [{ adminId: 'a1' }] })
    expect(vi.mocked(heartbeat).mock.calls[0][1]).toEqual({ type: 'product', id: ID, adminId: 'a1', tabId: 'tab-1', mode: 'edit', leaving: undefined })
    expect(publishLockEvent).not.toHaveBeenCalled()
  })

  it('publishes a presence event when viewers changed', async () => {
    vi.mocked(heartbeat).mockResolvedValue({ changed: true } as any)
    await POST(req(good))
    expect(publishLockEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'presence', resourceType: 'product', resourceId: ID, by: 'a1' }))
  })

  it('returns just ok when the tab is leaving', async () => {
    const res = await POST(req({ ...good, leaving: true }))
    expect(await res.json()).toEqual({ ok: true })
    expect(getDraftLockState).not.toHaveBeenCalled()
  })

  it('propagates a store failure', async () => {
    vi.mocked(heartbeat).mockRejectedValue(new Error('db'))
    await expect(POST(req(good))).rejects.toThrow('db')
  })
})
