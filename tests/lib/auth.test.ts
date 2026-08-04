import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock @/lib/db ─────────────────────────────────────────────────────────────
const mockQueryOne = vi.fn()
const mockQuery = vi.fn()

vi.mock('@/lib/db', () => ({
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: (...args: unknown[]) => mockQuery(...args),
}))

// ── Mock bcrypt ───────────────────────────────────────────────────────────────
const mockBcryptCompare = vi.fn()
const mockBcryptHash = vi.fn()

vi.mock('bcrypt', () => ({
  default: {
    compare: (...args: unknown[]) => mockBcryptCompare(...args),
    hash: (...args: unknown[]) => mockBcryptHash(...args),
  },
}))

// ── Import under test ─────────────────────────────────────────────────────────
import {
  createAdminUser,
  hasAdminRole,
  isSessionValid,
} from '@/lib/auth'

// ─────────────────────────────────────────────────────────────────────────────

describe('createAdminUser', () => {
  const userData = {
    email: 'new@example.com',
    first_name: 'New',
    last_name: 'Admin',
    phone: '1234567890',
    username: 'newadmin',
    password: 'securepass',
    role: 'admin',
    scopes: ['dashboard'],
  }

  beforeEach(() => {
    mockBcryptHash.mockResolvedValue('hashed_password')
  })

  it('creates new user and admin when email does not exist', async () => {
    const newUser = { id: 'user-99', email: userData.email }
    const newAdmin = { id: 'admin-99', user_id: 'user-99', username: userData.username }

    // first queryOne: check existing user → null
    mockQueryOne.mockResolvedValueOnce(null)
    // second queryOne: insert user → newUser
    mockQueryOne.mockResolvedValueOnce(newUser)
    // third queryOne: insert admin → newAdmin
    mockQueryOne.mockResolvedValueOnce(newAdmin)

    const result = await createAdminUser(userData)
    expect(result.success).toBe(true)
    expect(result.admin).toEqual(newAdmin)
  })

  it('updates existing user when email already exists without an admin', async () => {
    const existingUser = { id: 'user-50', email: userData.email }
    const updatedUser = { ...existingUser, first_name: 'New' }
    const newAdmin = { id: 'admin-50', user_id: 'user-50' }

    mockQueryOne.mockResolvedValueOnce(existingUser)   // existing user found
    mockQueryOne.mockResolvedValueOnce(updatedUser)    // update returns updated user
    mockQueryOne.mockResolvedValueOnce(newAdmin)       // insert admin

    const result = await createAdminUser(userData)
    expect(result.success).toBe(true)
    // Verify the UPDATE query was called
    expect(mockQueryOne.mock.calls[1][0]).toMatch(/UPDATE users/)
  })

  it('uses default role "admin" when role not provided', async () => {
    const { role: _, ...withoutRole } = userData
    mockQueryOne.mockResolvedValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({ id: 'u1' })
    mockQueryOne.mockResolvedValueOnce({ id: 'a1' })

    await createAdminUser(withoutRole)
    const adminInsertCall = mockQueryOne.mock.calls[2]
    expect(adminInsertCall[1]).toContain('admin')
  })

  it('returns failure when user creation fails', async () => {
    mockQueryOne.mockResolvedValueOnce(null)  // no existing user
    mockQueryOne.mockResolvedValueOnce(null)  // insert returns null

    const result = await createAdminUser(userData)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to create user')
  })

  it('returns failure when admin creation fails', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({ id: 'u1' })
    mockQueryOne.mockResolvedValueOnce(null)  // admin insert returns null

    const result = await createAdminUser(userData)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to create admin')
  })

  it('returns failure on database error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'))

    const result = await createAdminUser(userData)
    expect(result.success).toBe(false)
    expect(result.error).toBe('connection refused')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('hasAdminRole', () => {
  it('returns true when session admin has same role', () => {
    expect(hasAdminRole({ admin: { role: 'admin' } }, 'admin')).toBe(true)
  })

  it('returns true when super_admin checks for admin (higher rank)', () => {
    expect(hasAdminRole({ admin: { role: 'super_admin' } }, 'admin')).toBe(true)
  })

  it('returns true when super_admin checks for moderator', () => {
    expect(hasAdminRole({ admin: { role: 'super_admin' } }, 'moderator')).toBe(true)
  })

  it('returns false when moderator tries admin access', () => {
    expect(hasAdminRole({ admin: { role: 'moderator' } }, 'admin')).toBe(false)
  })

  it('returns false when moderator tries super_admin access', () => {
    expect(hasAdminRole({ admin: { role: 'moderator' } }, 'super_admin')).toBe(false)
  })

  it('returns false when session is null', () => {
    expect(hasAdminRole(null, 'admin')).toBe(false)
  })

  it('returns false when session has no admin property', () => {
    expect(hasAdminRole({}, 'admin')).toBe(false)
  })

  it('returns false for unknown role', () => {
    expect(hasAdminRole({ admin: { role: 'unknown' } }, 'admin')).toBe(false)
  })

  it('defaults required role to admin when not specified', () => {
    expect(hasAdminRole({ admin: { role: 'admin' } })).toBe(true)
    expect(hasAdminRole({ admin: { role: 'moderator' } })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('isSessionValid', () => {
  it('returns true for a session expiring in the future', () => {
    const session = { exp: Date.now() + 60_000 }
    expect(isSessionValid(session)).toBe(true)
  })

  it('returns false for an expired session', () => {
    const session = { exp: Date.now() - 1 }
    expect(isSessionValid(session)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isSessionValid(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isSessionValid(undefined)).toBe(false)
  })

  it('returns false when exp is missing', () => {
    expect(isSessionValid({})).toBe(false)
  })

  it('returns false for session with exp of zero', () => {
    expect(isSessionValid({ exp: 0 })).toBe(false)
  })
})
