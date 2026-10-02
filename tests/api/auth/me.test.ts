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

vi.mock('@/lib/auth/jwt', () => ({
  authenticateUser: vi.fn(),
  authenticateBusiness: vi.fn(),
  authenticateAnyUser: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auth/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/legals/policies', () => ({
  POLICY_VERSION: 'v1',
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}))

import { GET } from '@/app/api/(public)/auth/me/route'
import { POST as logoutPOST } from '@/app/api/(public)/auth/logout/route'
import * as jwtLib from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'

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
    vi.mocked(jwtLib.authenticateAnyUser).mockResolvedValue(null)

    const res = await GET(meRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBeNull()
  })

  it('returns user:null when token is invalid', async () => {
    vi.mocked(jwtLib.authenticateAnyUser).mockResolvedValue(null)

    const res = await GET(meRequest('bad-token') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBeNull()
  })

  it('returns user:null when user row not found in DB', async () => {
    vi.mocked(jwtLib.authenticateAnyUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue(null)

    const res = await GET(meRequest('valid-token') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user).toBeNull()
  })

  it('returns 200 with full user object for valid token', async () => {
    vi.mocked(jwtLib.authenticateAnyUser).mockResolvedValue(USER_PAYLOAD)
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
    vi.mocked(jwtLib.authenticateAnyUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue(USER_ROW)

    const res = await GET(meRequest('valid-token') as any)
    const body = await res.json()
    expect(body.user.requiresPolicyAcceptance).toBe(false)
    expect(body.user.policyVersion).toBe('v1')
  })

  it('sets requiresPolicyAcceptance:true when version is outdated', async () => {
    vi.mocked(jwtLib.authenticateAnyUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue({ ...USER_ROW, policies_accepted_version: 'v0' })

    const res = await GET(meRequest('valid-token') as any)
    const body = await res.json()
    expect(body.user.requiresPolicyAcceptance).toBe(true)
  })

  it('queries DB with correct userId from token', async () => {
    vi.mocked(jwtLib.authenticateAnyUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue(USER_ROW)

    await GET(meRequest('valid-token') as any)
    expect(db.queryOne).toHaveBeenCalledWith(expect.stringContaining('FROM users'), ['user-1'])
  })

  // Regression: a business user browsing the storefront authenticates on business_sid via
  // authenticateAnyUser. /me must return them (not user:null), or /account bounces to /login on
  // reload. The DB query must no longer exclude user_type='business'.
  it('returns the user for a business session and flags isBusiness', async () => {
    vi.mocked(jwtLib.authenticateAnyUser).mockResolvedValue({
      userId: 'biz-1',
      email: 'biz@example.com',
      isBusiness: true,
    } as any)
    vi.mocked(db.queryOne).mockResolvedValue({ ...USER_ROW, id: 'biz-1', user_type: 'business' })

    const res = await GET(meRequest('biz-token') as any)
    const body = await res.json()
    expect(body.user).not.toBeNull()
    expect(body.user.id).toBe('biz-1')
    expect(body.user.isBusiness).toBe(true)
    // The row lookup must not filter business users out.
    expect(db.queryOne).toHaveBeenCalledWith(expect.not.stringContaining("!= 'business'"), ['biz-1'])
  })

  it('flags isBusiness:false for a customer session', async () => {
    vi.mocked(jwtLib.authenticateAnyUser).mockResolvedValue(USER_PAYLOAD)
    vi.mocked(db.queryOne).mockResolvedValue({ ...USER_ROW, user_type: 'customer' })

    const res = await GET(meRequest('valid-token') as any)
    const body = await res.json()
    expect(body.user.isBusiness).toBe(false)
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
    const sessionSetCalls = mockCookieStore.set.mock.calls.filter((c: any[]) => c[0] === 'session_id')
    const guestCall = sessionSetCalls.find((c: any[]) => typeof c[1] === 'string' && c[1].startsWith('guest_'))
    expect(guestCall).toBeDefined()
  })
})
