import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/admin/editor-sessions', () => ({ openSession: vi.fn(), RESOURCE_TYPES: ['product', 'brand'] }))
vi.mock('@/lib/admin/draft-locks', () => ({ announceDraftLock: vi.fn(), draftLockResponse: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/editor-sessions/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { openSession } from '@/lib/admin/editor-sessions'
import { announceDraftLock, draftLockResponse } from '@/lib/admin/draft-locks'

const ID = '11111111-1111-4111-8111-111111111111'
const req = (body: unknown) => new NextRequest('http://localhost/api/admin/editor-sessions', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const good = { resource_type: 'product', resource_id: ID }

describe('POST /api/admin/editor-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['x'] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(draftLockResponse).mockReturnValue(null as any)
    vi.mocked(openSession).mockResolvedValue({ id: 's1', resumed: false, startedAt: 't', changeCount: 0, lock: { ownerId: 'a1' } } as any)
  })

  it('401s without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(good))).status).toBe(401)
  })

  it('400s on bad json, type and id', async () => {
    expect((await POST(req('nope'))).status).toBe(400)
    expect((await POST(req({ ...good, resource_type: 'x' }))).status).toBe(400)
    expect((await POST(req({ ...good, resource_id: 'nope' }))).status).toBe(400)
    expect(openSession).not.toHaveBeenCalled()
  })

  it('403s without the resources write scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req(good))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('manager', ['x'], 'products:write')
    expect(openSession).not.toHaveBeenCalled()
  })

  it('opens the session and announces the lock', async () => {
    const res = await POST(req(good))
    expect(await res.json()).toEqual({ session_id: 's1', resumed: false, started_at: 't', change_count: 0 })
    expect(openSession).toHaveBeenCalledWith('a1', 'product', ID, { adminId: 'a1', role: 'manager', scopes: ['x'] })
    expect(announceDraftLock).toHaveBeenCalledWith(expect.anything(), 'product', ID, { ownerId: 'a1' })
  })

  it('skips the announcement when no lock was taken', async () => {
    vi.mocked(openSession).mockResolvedValue({ id: 's1', resumed: true, startedAt: 't', changeCount: 2, lock: null } as any)
    await POST(req(good))
    expect(announceDraftLock).not.toHaveBeenCalled()
  })

  it('404s when the resource does not exist', async () => {
    vi.mocked(openSession).mockResolvedValue(null as any)
    expect((await POST(req(good))).status).toBe(404)
  })

  it('returns 423 when another admin holds the lock, and rethrows other errors', async () => {
    vi.mocked(openSession).mockRejectedValueOnce(new Error('locked'))
    vi.mocked(draftLockResponse).mockReturnValueOnce(NextResponse.json({}, { status: 423 }) as any)
    expect((await POST(req(good))).status).toBe(423)
    vi.mocked(openSession).mockRejectedValueOnce(new Error('boom'))
    await expect(POST(req(good))).rejects.toThrow('boom')
  })
})
