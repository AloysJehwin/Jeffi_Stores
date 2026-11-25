import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/admin-notify', () => ({ listAdminNotifications: vi.fn() }))
vi.mock('@/lib/auth/auth-sessions', () => ({ getSessionDeadline: vi.fn(), revokeSessionById: vi.fn() }))
vi.mock('@/lib/auth/session-events', () => ({ subscribeSessionEvents: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn(), runWithTenantContext: vi.fn((_t: unknown, fn: () => unknown) => fn()) }))
vi.mock('@jeffi/draft-locks', () => ({ changedSince: vi.fn(), DRAFT_RESOURCES: { product: { readScope: 'products:read' } } }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/admin/draft-lock-events', () => ({ subscribeLockFrames: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/events/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { listAdminNotifications } from '@/lib/shared/admin-notify'
import { subscribeSessionEvents } from '@/lib/auth/session-events'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { changedSince } from '@jeffi/draft-locks'
import { hasScope } from '@/lib/auth/scopes'
import { subscribeLockFrames } from '@/lib/admin/draft-lock-events'

const ac = new AbortController()
const req = () => new NextRequest('http://localhost/api/admin/events', { signal: ac.signal })

async function readFrames(res: Response, n: number) {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let text = ''
  while ((text.match(/\n\n/g) ?? []).length < n) {
    const { value, done } = await reader.read()
    if (done) break
    text += dec.decode(value)
  }
  reader.releaseLock()
  return text.split('\n\n').filter(Boolean).map(f => JSON.parse(f.replace(/^data: /, '')))
}

describe('GET /api/admin/events', () => {
  let sessionCb: ((ev: any) => void) | null
  beforeEach(() => {
    vi.clearAllMocks()
    sessionCb = null
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [], sessionId: 's1', deadlineAt: new Date(Date.now() + 600_000), expiresAt: new Date(Date.now() + 900_000) } as any)
    vi.mocked(resolveTenant).mockResolvedValue(null as any)
    vi.mocked(subscribeSessionEvents).mockImplementation(((_id: string, cb: any) => { sessionCb = cb; return () => {} }) as any)
    vi.mocked(subscribeLockFrames).mockReturnValue(() => {})
    vi.mocked(changedSince).mockResolvedValue({ cursor: 'c', locks: [] } as any)
    vi.mocked(listAdminNotifications).mockResolvedValue({ items: [{ id: 'n1', is_read: false }], unreadCount: 1 } as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })
  afterEach(() => {
    ac.abort()
  })

  it('401s without a session or session id (passive auth)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1' } as any)
    expect((await GET(req())).status).toBe(401)
    expect(authenticateAdmin).toHaveBeenCalledWith(expect.anything(), { passive: true })
  })

  it('streams hello then the notification snapshot', async () => {
    const res = await GET(req())
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const frames = await readFrames(res, 2)
    expect(frames[0]).toMatchObject({ kind: 'session', type: 'hello' })
    expect(frames[1]).toEqual({ kind: 'notifications', items: [{ id: 'n1', is_read: false }], unreadCount: 1 })
    expect(listAdminNotifications).toHaveBeenCalledWith('manager', [], 30, 'a1')
  })

  it('forwards a logout event from another tab', async () => {
    const res = await GET(req())
    const reader = res.body!.getReader()
    await reader.read()
    sessionCb!({ type: 'logout', reason: 'revoked' })
    const dec = new TextDecoder()
    let text = ''
    for (let i = 0; i < 5 && !text.includes('logout'); i++) text += dec.decode((await reader.read()).value ?? new Uint8Array())
    expect(text).toContain('"type":"logout"')
    expect(text).toContain('"reason":"revoked"')
  })

  it('emits lock frames from the poll only for readable resource types', async () => {
    vi.mocked(changedSince).mockResolvedValue({
      cursor: 'c2',
      locks: [
        { resourceType: 'product', resourceId: 'p1', ownerId: 'a2', closedAt: null, via: 'takeover', reason: 'r', updatedAt: 't' },
        { resourceType: 'unknown', resourceId: 'x', ownerId: 'a2', closedAt: null, updatedAt: 't' },
      ],
    } as any)
    const res = await GET(req())
    const frames = await readFrames(res, 3)
    const lockFrames = frames.filter(f => f.kind === 'lock')
    expect(lockFrames).toHaveLength(1)
    expect(lockFrames[0]).toMatchObject({ type: 'takeover', resourceType: 'product', resourceId: 'p1' })
  })

  it('keeps streaming when the notification read fails', async () => {
    vi.mocked(listAdminNotifications).mockRejectedValue(new Error('db'))
    const res = await GET(req())
    const frames = await readFrames(res, 1)
    expect(frames[0].type).toBe('hello')
  })
})
