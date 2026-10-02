import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCookieStore = vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256'
  return {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }
})

vi.mock('@/lib/auth/otp', () => ({
  isOTPVerified: vi.fn(),
  deleteOTP: vi.fn().mockResolvedValue(undefined),
  resetSendOtpCounter: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

// Opaque sessions: signup issues a server-side session and sets cookie = sid.
// Mocking issueUserToken avoids exercising createSession's DB INSERT.
vi.mock('@/lib/auth/issue-session', () => ({
  issueUserToken: vi.fn().mockResolvedValue({ sid: 'user-sid' }),
  USER_SESSION_TTL_S: 30 * 24 * 60 * 60,
}))

vi.mock('@/lib/email', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
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

import { POST } from '@/app/api/(public)/auth/signup/route'
import * as otpLib from '@/lib/auth/otp'
import * as db from '@/lib/shared/db'

function makeRequest(body: object) {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  email: 'new@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  phone: '9876543210',
}

const NEW_USER = {
  id: 'new-user-1',
  email: 'new@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  phone: '9876543210',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/auth/signup', () => {
  describe('missing required fields', () => {
    it('returns 400 when email is missing', async () => {
      const res = await POST(makeRequest({ firstName: 'Jane', phone: '9876543210' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })

    it('returns 400 when firstName is missing', async () => {
      const res = await POST(makeRequest({ email: 'x@x.com', phone: '9876543210' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })

    it('returns 400 when phone is missing', async () => {
      const res = await POST(makeRequest({ email: 'x@x.com', firstName: 'Jane' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })
  })

  describe('OTP not verified', () => {
    it('returns 400 when OTP has not been verified', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(false)

      const res = await POST(makeRequest(VALID_BODY) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/verify.*otp/i)
    })
  })

  describe('invalid phone number', () => {
    it('returns 400 for phone shorter than 10 digits', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)

      const res = await POST(makeRequest({ ...VALID_BODY, phone: '12345' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/10-digit/i)
    })

    it('strips country code 91 prefix and accepts 12-digit number', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await POST(makeRequest({ ...VALID_BODY, phone: '919876543210' }) as any)
      expect(res.status).toBe(200)
    })
  })

  describe('duplicate email', () => {
    it('returns 400 when email is already registered', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValue({ id: 'existing-1' })

      const res = await POST(makeRequest(VALID_BODY) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/already registered/i)
    })
  })

  describe('successful signup', () => {
    it('returns 200 with user data on successful registration', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await POST(makeRequest(VALID_BODY) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toMatch(/created/i)
      expect(body.user.id).toBe('new-user-1')
      expect(body.user.email).toBe('new@example.com')
    })

    it('sets user_sid cookie on successful signup', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await POST(makeRequest(VALID_BODY) as any)
      const cookie = res.cookies.get('user_sid')
      expect(cookie?.value).toBe('user-sid')
      expect(cookie?.httpOnly).toBe(true)
    })

    it('deletes OTP and resets counter after signup', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      await POST(makeRequest(VALID_BODY) as any)
      expect(otpLib.deleteOTP).toHaveBeenCalledWith('new@example.com')
      expect(otpLib.resetSendOtpCounter).toHaveBeenCalledWith('new@example.com')
    })
  })

  describe('DB insert fails', () => {
    it('returns 500 when INSERT returns null', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await POST(makeRequest(VALID_BODY) as any)
      expect(res.status).toBe(500)
    })
  })
})
