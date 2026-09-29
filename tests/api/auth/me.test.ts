/**
 * Tests for:
 *   GET  /api/auth/me     (src/app/api/auth/me/route.ts)
 *   POST /api/auth/logout (src/app/api/auth/logout/route.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCookieStore = vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256'
  return {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }
})

vi.mock('@/lib/jwt', () => ({
  authenticateUser: vi.fn(),
  authenticateBusiness: vi.fn(),
  authenticateAnyUser: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/legals/policies', () => ({
  POLICY_VERSION: 'v1',
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}))

import { GET } from '@/app/api/auth/me/route'
import { POST as logoutPOST } from '@/app/api/auth/logout/route'
import * as jwtLib from '@/lib/jwt'
import * as db from '@/lib/db'

function meRequest(cookieValue?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookieValue) headers['Cookie'] = `user_sid=${cookieValue}`
  return new Request('http://localhost/api/auth/me', { method: 'GET', headers })
}

function logoutRequest() {
  return new Request('http://localhost/api/auth/logout', { method: 'POST' })
}

const USER_PAYLOAD = { userId: 'user-1', email: 'user@example.com', type: 'customer' }
const USER_ROW = {
  id: 'user-1',
  email: 'user@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  phone: '9876543210',
  created_at: '2024-01-01',
  avatar_url: null,
  policies_accepted_version: 'v1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET /api/auth/me ─────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns user:null when no token is provided', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(null)

    const res = await GET(meRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBeNull()
  })

  it('returns user:null when token is invalid', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(null)

    const res = await GET(meRequest('bad-token') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBeNull()
  })

  it('returns user:null when user row not found in DB', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue(null)

    const res = await GET(meRequest('valid-token') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBeNull()
  })

  it('returns 200 with full user object for valid token', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue(USER_ROW)

    const res = await GET(meRequest('valid-token') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.id).toBe('user-1')
    expect(body.user.email).toBe('user@example.com')
    expect(body.user.firstName).toBe('Jane')
    expect(body.user.lastName).toBe('Doe')
    expect(body.user.phone).toBe('9876543210')
  })

  it('sets requiresPolicyAcceptance:false when version matches', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue(USER_ROW)

    const res = await GET(meRequest('valid-token') as any)
    const body = await res.json()
    expect(body.user.requiresPolicyAcceptance).toBe(false)
    expect(body.user.policyVersion).toBe('v1')
  })

  it('sets requiresPolicyAcceptance:true when version is outdated', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue({ ...USER_ROW, policies_accepted_version: 'v0' })

    const res = await GET(meRequest('valid-token') as any)
    const body = await res.json()
    expect(body.user.requiresPolicyAcceptance).toBe(true)
  })

  it('queries DB with correct userId from token', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue(USER_ROW)

    await GET(meRequest('valid-token') as any)
    expect(db.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('FROM users'),
      ['user-1']
    )
  })
})

// ── POST /api/auth/logout ────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('returns 200 with success message', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(null)

    const res = await logoutPOST(logoutRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/logged out/i)
  })

  it('clears user_sid cookie via Set-Cookie header', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(null)

    const res = await logoutPOST(logoutRequest() as any)
    const setCookieHeader = res.headers.get('set-cookie')
    expect(setCookieHeader).toMatch(/user_sid=/)
    expect(setCookieHeader).toMatch(/Max-Age=0/)
  })

  it('clears user_sid when user is authenticated', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(USER_PAYLOAD)

    const res = await logoutPOST(logoutRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/logged out/i)
  })

  it('sets new guest session cookie via cookie store', async () => {
    vi.mocked(jwtLib.authenticateUser).mockResolvedValue(USER_PAYLOAD)

    await logoutPOST(logoutRequest() as any)
    const sessionSetCalls = mockCookieStore.set.mock.calls.filter(
      (c: any[]) => c[0] === 'session_id'
    )
    const guestCall = sessionSetCalls.find((c: any[]) =>
      typeof c[1] === 'string' && c[1].startsWith('guest_')
    )
    expect(guestCall).toBeDefined()
  })
})
