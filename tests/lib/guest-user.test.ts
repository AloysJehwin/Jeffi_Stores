import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock @/lib/db ─────────────────────────────────────────────────────────────
const mockQueryOne = vi.fn()
const mockQuery = vi.fn()

vi.mock('@/lib/db', () => ({
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: (...args: unknown[]) => mockQuery(...args),
}))

// ── Import under test ─────────────────────────────────────────────────────────
import {
  getOrCreateGuestUser,
  mergeGuestToUser,
  getUserIdForSession,
} from '@/lib/guest-user'

// ─────────────────────────────────────────────────────────────────────────────

describe('getOrCreateGuestUser', () => {
  const SESSION_ID = 'sess_abc123'

  it('returns existing guest user ID when session already has one', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'guest-uuid-existing' })

    const id = await getOrCreateGuestUser(SESSION_ID)
    expect(id).toBe('guest-uuid-existing')
    expect(mockQueryOne).toHaveBeenCalledOnce()
  })

  it('queries by session_id with is_guest=true and no merged_to_user_id', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'guest-uuid-existing' })

    await getOrCreateGuestUser(SESSION_ID)

    const [sql, params] = mockQueryOne.mock.calls[0]
    expect(sql).toContain('session_id')
    expect(sql).toContain('is_guest = true')
    expect(sql).toContain('merged_to_user_id IS NULL')
    expect(params).toContain(SESSION_ID)
  })

  it('creates a new guest user when no existing one found', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)                        // no existing guest
      .mockResolvedValueOnce({ id: 'new-guest-uuid' })   // insert returns new

    const id = await getOrCreateGuestUser(SESSION_ID)
    expect(id).toBe('new-guest-uuid')
    expect(mockQueryOne).toHaveBeenCalledTimes(2)
  })

  it('inserts guest with email derived from session_id', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'new-uuid' })

    await getOrCreateGuestUser(SESSION_ID)

    const [sql, params] = mockQueryOne.mock.calls[1]
    expect(sql).toContain('INSERT INTO users')
    expect(params).toContain(`guest_${SESSION_ID}@temporary.local`)
    expect(params).toContain(SESSION_ID)
    expect(params).toContain(true)   // is_guest
  })

  it('throws when insert returns null (db failure)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)  // no existing
      .mockResolvedValueOnce(null)  // insert fails

    await expect(getOrCreateGuestUser(SESSION_ID))
      .rejects.toThrow('Failed to create guest user')
  })

  it('propagates unexpected database errors', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('DB timeout'))

    await expect(getOrCreateGuestUser(SESSION_ID))
      .rejects.toThrow('DB timeout')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('mergeGuestToUser', () => {
  const GUEST_ID = 'guest-uuid-1'
  const USER_ID = 'user-uuid-2'

  it('calls merge_guest_cart_to_user with correct IDs', async () => {
    mockQuery.mockResolvedValueOnce(undefined)

    await mergeGuestToUser(GUEST_ID, USER_ID)

    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('merge_guest_cart_to_user')
    expect(params).toEqual([GUEST_ID, USER_ID])
  })

  it('resolves without throwing on success', async () => {
    mockQuery.mockResolvedValueOnce(undefined)
    await expect(mergeGuestToUser(GUEST_ID, USER_ID)).resolves.toBeUndefined()
  })

  it('re-throws on database error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('merge failed'))
    await expect(mergeGuestToUser(GUEST_ID, USER_ID)).rejects.toThrow('merge failed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('getUserIdForSession', () => {
  describe('authenticated user', () => {
    it('returns authUserId directly without hitting db', async () => {
      const id = await getUserIdForSession('any-session', 'auth-user-uuid')
      expect(id).toBe('auth-user-uuid')
      expect(mockQueryOne).not.toHaveBeenCalled()
    })

    it('returns authUserId even when sessionId is undefined', async () => {
      const id = await getUserIdForSession(undefined, 'auth-user-uuid')
      expect(id).toBe('auth-user-uuid')
    })
  })

  describe('guest user with existing session', () => {
    it('returns existing guest ID for the session', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'existing-guest' })

      const id = await getUserIdForSession('sess_known', undefined)
      expect(id).toBe('existing-guest')
    })

    it('passes the session ID to getOrCreateGuestUser', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'g-uuid' })

      await getUserIdForSession('my-session-id', undefined)

      const [, params] = mockQueryOne.mock.calls[0]
      expect(params).toContain('my-session-id')
    })
  })

  describe('guest user without session', () => {
    it('auto-generates a session ID and creates a guest when sessionId is undefined', async () => {
      mockQueryOne
        .mockResolvedValueOnce(null)                      // no existing
        .mockResolvedValueOnce({ id: 'fresh-guest' })    // insert

      const id = await getUserIdForSession(undefined, undefined)
      expect(id).toBe('fresh-guest')

      // The generated session_id should start with "guest_"
      const [, params] = mockQueryOne.mock.calls[0]
      expect(params[0]).toMatch(/^guest_\d+_/)
    })

    it('creates a new guest when session not found', async () => {
      mockQueryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'new-guest-123' })

      const id = await getUserIdForSession('new-session', undefined)
      expect(id).toBe('new-guest-123')
    })
  })

  describe('error handling', () => {
    it('propagates db error from getOrCreateGuestUser', async () => {
      mockQueryOne.mockRejectedValueOnce(new Error('connection error'))

      await expect(getUserIdForSession('sess', undefined))
        .rejects.toThrow('connection error')
    })
  })
})
