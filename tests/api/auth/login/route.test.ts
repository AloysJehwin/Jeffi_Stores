import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted runs before all imports and vi.mock factories — the only place
// where process.env can be set in time for top-level module guards.
const mockCookieStore = vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256'
  return {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }
})

vi.mock('@/lib/otp', () => ({
  verifyOTP: vi.fn(),
  deleteOTP: vi.fn().mockResolvedValue(undefined),
  resetSendOtpCounter: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

// Opaque sessions: login issues a server-side session and sets cookie = sid.
// Mocking issueUserToken avoids exercising createSession's DB INSERT.
vi.mock('@/lib/issue-session', () => ({
  issueUserToken: vi.fn().mockResolvedValue({ sid: 'user-sid' }),
  USER_SESSION_TTL_S: 7 * 24 * 60 * 60,
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

import { POST } from '@/app/api/auth/login/route'
import { NextRequest } from 'next/server'
import * as otpLib from '@/lib/otp'
import * as db from '@/lib/db'

// ── helpers ─────────────────────────────────────────────────────────────────
function makeRequest(body: object, sessionCookie?: string) {
  const req = new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (sessionCookie) req.cookies.set('session_id', sessionCookie)
  return req
}

const ACTIVE_USER = {
  id: 'user-1',
  email: 'user@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  phone: '9876543210',
  is_active: true,
  policies_accepted_version: 'v1',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCookieStore.get.mockReturnValue(undefined)
})

// ── tests ────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  describe('missing fields', () => {
    it('returns 400 when email is missing', async () => {
      const res = await POST(makeRequest({ otp: '123456' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })

    it('returns 400 when otp is missing', async () => {
      const res = await POST(makeRequest({ email: 'user@example.com' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })
  })

  describe('OTP verification fails', () => {
    it('returns 400 when OTP is invalid', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: false, message: 'Invalid OTP' })
      vi.mocked(db.queryOne).mockResolvedValue(null)

      const res = await POST(makeRequest({ email: 'user@example.com', otp: '000000' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid OTP')
    })
  })

  describe('OTP valid, user not found → new user flow', () => {
    it('returns 200 with isNewUser:true when user does not exist at all', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(null) // no customer
        .mockResolvedValueOnce(null) // no business either

      const res = await POST(makeRequest({ email: 'new@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.isNewUser).toBe(true)
      expect(body.email).toBe('new@example.com')
    })

    it('returns 403 when only a business account exists — prevents duplicate customer creation', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne)
        .mockResolvedValueOnce(null) // no customer account
        .mockResolvedValueOnce({ id: 'biz-1', email: 'biz@example.com', user_type: 'business' }) // business account exists

      const res = await POST(makeRequest({ email: 'biz@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toMatch(/business portal/i)
    })
  })

  describe('OTP valid, user found but inactive', () => {
    it('returns 403 for inactive account', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue({ ...ACTIVE_USER, is_active: false })

      const res = await POST(makeRequest({ email: 'user@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toMatch(/inactive/i)
    })
  })

  describe('successful login', () => {
    it('returns 200 with user data on valid credentials', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue(ACTIVE_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await POST(makeRequest({ email: 'user@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toBe('Login successful')
      expect(body.user.id).toBe('user-1')
      expect(body.user.email).toBe('user@example.com')
    })

    it('sets user_sid cookie on successful login', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue(ACTIVE_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await POST(makeRequest({ email: 'user@example.com', otp: '123456' }) as any)
      const cookie = res.cookies.get('user_sid')
      expect(cookie?.value).toBeTruthy()
      expect(cookie?.httpOnly).toBe(true)
    })

    it('calls deleteOTP and resetSendOtpCounter after login', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue(ACTIVE_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      await POST(makeRequest({ email: 'user@example.com', otp: '123456' }) as any)
      expect(otpLib.deleteOTP).toHaveBeenCalledWith('user@example.com')
      expect(otpLib.resetSendOtpCounter).toHaveBeenCalledWith('user@example.com')
    })
  })

  describe('guest cart merge', () => {
    it('merges guest cart when guest session cookie present', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValueOnce(ACTIVE_USER).mockResolvedValueOnce({ id: 'guest-1' })
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      await POST(makeRequest({ email: 'user@example.com', otp: '123456' }, 'guest_12345_abc') as any)
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('merge_guest_cart_to_user'),
        expect.arrayContaining(['guest-1', 'user-1'])
      )
    })
  })
})
