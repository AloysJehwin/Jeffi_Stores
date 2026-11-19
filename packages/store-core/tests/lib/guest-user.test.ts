import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock @/lib/shared/db ─────────────────────────────────────────────────────────────
const mockQueryOne = vi.fn()
const mockQuery = vi.fn()

vi.mock('@/lib/shared/db', () => ({
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: (...args: unknown[]) => mockQuery(...args),
}))

// ── Import under test ─────────────────────────────────────────────────────────
let mockCookie: string | undefined
const mockCookieSet = vi.fn()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (mockCookie ? { value: mockCookie } : undefined),
    set: (...args: unknown[]) => mockCookieSet(...args),
  }),
}))

import { getOrCreateGuestUser, mergeGuestToUser, existingCartOwner, cartOwner } from '@/lib/shared/guest-user'

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
      .mockResolvedValueOnce(null) // no existing guest
      .mockResolvedValueOnce({ id: 'new-guest-uuid' }) // insert returns new

    const id = await getOrCreateGuestUser(SESSION_ID)
    expect(id).toBe('new-guest-uuid')
    expect(mockQueryOne).toHaveBeenCalledTimes(2)
  })

  it('inserts guest with email derived from session_id', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'new-uuid' })

    await getOrCreateGuestUser(SESSION_ID)

    const [sql, params] = mockQueryOne.mock.calls[1]
    expect(sql).toContain('INSERT INTO users')
    expect(params).toContain(`guest_${SESSION_ID}@temporary.local`)
    expect(params).toContain(SESSION_ID)
    expect(params).toContain(true) // is_guest
  })

  it('throws when insert returns null (db failure)', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing
      .mockResolvedValueOnce(null) // insert fails

    await expect(getOrCreateGuestUser(SESSION_ID)).rejects.toThrow('Failed to create guest user')
  })

  it('propagates unexpected database errors', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('DB timeout'))

    await expect(getOrCreateGuestUser(SESSION_ID)).rejects.toThrow('DB timeout')
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

describe('existingCartOwner', () => {
  it('returns the signed-in user without touching the db', async () => {
    expect(await existingCartOwner('auth-user-uuid')).toBe('auth-user-uuid')
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it("returns the session's guest", async () => {
    mockCookie = 'sess_known'
    mockQueryOne.mockResolvedValueOnce({ id: 'existing-guest' })
    expect(await existingCartOwner(undefined)).toBe('existing-guest')
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['sess_known'])
  })

  it('never creates a guest: a session without one reads as empty', async () => {
    mockCookie = 'sess_new'
    mockQueryOne.mockResolvedValueOnce(null)
    expect(await existingCartOwner(undefined)).toBeNull()
    expect(mockQueryOne).toHaveBeenCalledOnce()
  })

  it('gives a visitor without a session a cookie, and no row', async () => {
    mockCookie = undefined
    expect(await existingCartOwner(undefined)).toBeNull()
    expect(mockCookieSet).toHaveBeenCalledWith('session_id', expect.stringMatching(/^guest_\d+_/), expect.any(Object))
    expect(mockQueryOne).not.toHaveBeenCalled()
  })
})

describe('cartOwner', () => {
  it('makes the guest under the session cookie on the first save', async () => {
    mockCookie = 'sess_new'
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'fresh-guest' })
    expect(await cartOwner(undefined)).toBe('fresh-guest')
    expect(mockQueryOne.mock.calls[1][1]).toContain('sess_new')
    expect(mockCookieSet).not.toHaveBeenCalled()
  })

  it("takes the row a parallel request just made instead of failing", async () => {
    mockCookie = 'sess_race'
    mockQueryOne
      .mockResolvedValueOnce(null) // not there yet
      .mockResolvedValueOnce(null) // the other request's insert won
      .mockResolvedValueOnce({ id: 'winner' })
    expect(await cartOwner(undefined)).toBe('winner')
    expect(mockQueryOne.mock.calls[1][0]).toContain('ON CONFLICT DO NOTHING')
  })

  it('starts a new session when the cookie belongs to a guest who has signed in since', async () => {
    mockCookie = 'sess_merged'
    mockQueryOne
      .mockResolvedValueOnce(null) // no unmerged guest
      .mockResolvedValueOnce(null) // the merged guest holds the session
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null) // the new session has no guest yet
      .mockResolvedValueOnce({ id: 'new-session-guest' })
    expect(await cartOwner(undefined)).toBe('new-session-guest')
    const [name, value] = mockCookieSet.mock.calls[0]
    expect(name).toBe('session_id')
    expect(value).toMatch(/^guest_/)
    expect(value).not.toBe('sess_merged')
  })
})
