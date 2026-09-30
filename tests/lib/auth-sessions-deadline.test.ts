import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQueryOne = vi.fn()
const mockQuery = vi.fn()
vi.mock('@/lib/db', () => ({
  queryOne: (...a: any[]) => mockQueryOne(...a),
  query: (...a: any[]) => mockQuery(...a),
  queryMany: vi.fn(),
}))
const mockPublish = vi.fn()
vi.mock('@/lib/session-events', () => ({ publishSessionEvent: (...a: any[]) => mockPublish(...a) }))

import {
  computeDeadline,
  idleWindowMsFor,
  resolveSession,
  touchSession,
  getSessionDeadline,
  revokeSessionById,
  revokeSession,
  sweepExpiredAdminSessions,
  DEFAULT_ADMIN_IDLE_MINUTES,
} from '@/lib/auth-sessions'

const TOKEN = 'a'.repeat(64)
const ROW_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const flush = () => new Promise(r => setTimeout(r, 0))

function liveRow(over: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    principal_type: 'admin',
    principal_id: 'adm-1',
    revoked_at: null,
    expires_at: new Date(Date.now() + 8 * 3600_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    idle_timeout_minutes: 60,
    role: 'admin',
    scopes: ['dashboard:read'],
    cert_cn: null,
    approval_status: null,
    tenant_id: null,
    user_agent: null,
    accept_lang: null,
    ua_platform: null,
    ip_net: null,
    fp_hash: null,
    email: 'a@x.com',
    first_name: 'A',
    last_name: 'B',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('deadline math', () => {
  it('idle window: per-admin minutes, admin default, or the 24h cap for other principals', () => {
    expect(idleWindowMsFor('admin', 60)).toBe(60 * 60_000)
    expect(idleWindowMsFor('admin', null)).toBe(DEFAULT_ADMIN_IDLE_MINUTES * 60_000)
    expect(idleWindowMsFor('customer', 60)).toBe(24 * 3600_000)
  })

  it('deadline is the earlier of absolute expiry and last activity plus idle window', () => {
    const exp = '2030-01-01T10:00:00.000Z'
    const lastSeen = Date.parse('2030-01-01T09:00:00.000Z')
    expect(computeDeadline(exp, lastSeen, 30 * 60_000)).toBe('2030-01-01T09:30:00.000Z')
    expect(computeDeadline(exp, lastSeen, 5 * 3600_000)).toBe(exp)
  })
})

describe('resolveSession deadline + passive mode', () => {
  it('reports sessionId and a deadline based on last activity', async () => {
    const lastSeen = new Date(Date.now() - 10 * 60_000).toISOString()
    mockQueryOne.mockResolvedValue(liveRow({ last_seen_at: lastSeen }))
    const s = await resolveSession(TOKEN, undefined, { touch: false })
    expect(s?.sessionId).toBe(ROW_ID)
    expect(s?.idleWindowMs).toBe(60 * 60_000)
    expect(s?.deadlineAt).toBe(new Date(Date.parse(lastSeen) + 60 * 60_000).toISOString())
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('an active resolve past the touch window bumps last_seen_at and pushes the deadline out', async () => {
    mockQueryOne.mockResolvedValue(liveRow({ last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString() }))
    const before = Date.now()
    const s = await resolveSession(TOKEN)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('last_seen_at = now()'), [ROW_ID])
    expect(Date.parse(s!.deadlineAt)).toBeGreaterThanOrEqual(before + 60 * 60_000 - 50)
  })

  it('refuses a session idle past its window regardless of mode', async () => {
    mockQueryOne.mockResolvedValue(liveRow({ last_seen_at: new Date(Date.now() - 61 * 60_000).toISOString() }))
    expect(await resolveSession(TOKEN, undefined, { touch: false })).toBeNull()
  })
})

describe('touchSession', () => {
  it('moves last_seen_at, returns the new deadline and publishes it', async () => {
    const now = new Date().toISOString()
    mockQueryOne.mockResolvedValue({
      id: ROW_ID,
      principal_type: 'admin',
      expires_at: new Date(Date.now() + 3600_000 * 8).toISOString(),
      last_seen_at: now,
      idle_timeout_minutes: 120,
    })
    const d = await touchSession(TOKEN)
    expect(mockQueryOne.mock.calls[0][0]).toContain('SET last_seen_at = now()')
    expect(d?.deadlineAt).toBe(new Date(Date.parse(now) + 120 * 60_000).toISOString())
    await flush()
    expect(mockPublish).toHaveBeenCalledWith(
      ROW_ID,
      expect.objectContaining({ type: 'deadline', deadlineAt: d!.deadlineAt })
    )
  })

  it('returns null for a revoked or unknown session', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect(await touchSession(TOKEN)).toBeNull()
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

describe('getSessionDeadline', () => {
  it('null when revoked or already past the deadline, otherwise the deadline pair', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ROW_ID,
      principal_type: 'admin',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      last_seen_at: new Date().toISOString(),
      idle_timeout_minutes: 60,
      revoked_at: new Date().toISOString(),
    })
    expect(await getSessionDeadline(ROW_ID)).toBeNull()
    mockQueryOne.mockResolvedValueOnce({
      id: ROW_ID,
      principal_type: 'admin',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      last_seen_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
      idle_timeout_minutes: 60,
      revoked_at: null,
    })
    expect(await getSessionDeadline(ROW_ID)).toBeNull()
    const exp = new Date(Date.now() + 3600_000).toISOString()
    mockQueryOne.mockResolvedValueOnce({
      id: ROW_ID,
      principal_type: 'admin',
      expires_at: exp,
      last_seen_at: new Date().toISOString(),
      idle_timeout_minutes: 60,
      revoked_at: null,
    })
    const d = await getSessionDeadline(ROW_ID)
    expect(d?.expiresAt).toBe(exp)
  })
})

describe('revocation publishes logout to the session tabs', () => {
  it('revokeSessionById', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: ROW_ID }], rowCount: 1 })
    expect(await revokeSessionById(ROW_ID, 'idle')).toBe(true)
    await flush()
    expect(mockPublish).toHaveBeenCalledWith(ROW_ID, { type: 'logout', reason: 'idle' })
  })

  it('revokeSession by cookie token', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: ROW_ID }], rowCount: 1 })
    await revokeSession(TOKEN)
    await flush()
    expect(mockPublish).toHaveBeenCalledWith(ROW_ID, { type: 'logout', reason: 'logout' })
  })

  it('sweepExpiredAdminSessions revokes every stale row and notifies each', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 's1' }, { id: 's2' }], rowCount: 2 })
    const ids = await sweepExpiredAdminSessions()
    expect(ids).toEqual(['s1', 's2'])
    expect(mockQuery.mock.calls[0][0]).toContain('make_interval')
    await flush()
    expect(mockPublish).toHaveBeenCalledTimes(2)
  })
})
