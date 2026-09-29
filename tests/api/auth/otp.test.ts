/**
 * Tests for:
 *   POST /api/auth/send-otp   (src/app/api/auth/send-otp/route.ts)
 *   POST /api/auth/verify-otp (src/app/api/auth/verify-otp/route.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256'

vi.mock('@/lib/otp', () => ({
  generateOTP: vi.fn().mockReturnValue('123456'),
  storeOTP: vi.fn().mockResolvedValue(undefined),
  verifyOTP: vi.fn(),
  checkSendOtpRateLimit: vi.fn(),
  recordSendOtp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

vi.mock('@/lib/email', () => ({
  sendOTPEmail: vi.fn(),
}))

vi.mock('@/lib/legals/policies', () => ({
  POLICY_VERSION: 'v1',
}))

import { POST as sendOtpPOST } from '@/app/api/auth/send-otp/route'
import { POST as verifyOtpPOST } from '@/app/api/auth/verify-otp/route'
import * as otpLib from '@/lib/otp'
import * as db from '@/lib/db'
import * as emailLib from '@/lib/email'

// ── helpers ──────────────────────────────────────────────────────────────────

function sendRequest(body: object) {
  return new Request('http://localhost/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function verifyRequest(body: object) {
  return new Request('http://localhost/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ALLOWED_RATE_LIMIT = { allowed: true, retryAfter: 0, nextCooldown: 30 }
const EXISTING_USER = { id: 'user-1', first_name: 'Jane', policies_accepted_version: 'v1' }

beforeEach(() => {
  vi.clearAllMocks()
})

// ── send-otp ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/send-otp', () => {
  describe('input validation', () => {
    it('returns 400 when email is missing', async () => {
      const res = await sendOtpPOST(sendRequest({}) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })

    it('returns 400 for invalid email format', async () => {
      const res = await sendOtpPOST(sendRequest({ email: 'not-an-email' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/invalid email/i)
    })
  })

  describe('rate limiting', () => {
    it('returns 429 when rate limit exceeded', async () => {
      vi.mocked(otpLib.checkSendOtpRateLimit).mockResolvedValue({
        allowed: false,
        retryAfter: 60,
        nextCooldown: 60,
      })

      const res = await sendOtpPOST(sendRequest({ email: 'user@example.com' }) as any)
      expect(res.status).toBe(429)
      const body = await res.json()
      expect(body.retryAfter).toBe(60)
    })
  })

  describe('login flow (isSignup: false)', () => {
    it('returns 404 when user not found on login attempt', async () => {
      vi.mocked(otpLib.checkSendOtpRateLimit).mockResolvedValue(ALLOWED_RATE_LIMIT)
      vi.mocked(db.queryOne).mockResolvedValue(null)

      const res = await sendOtpPOST(sendRequest({ email: 'unknown@example.com', isSignup: false }) as any)
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.userNotFound).toBe(true)
    })

    it('returns 200 and sends OTP for known user', async () => {
      vi.mocked(otpLib.checkSendOtpRateLimit).mockResolvedValue(ALLOWED_RATE_LIMIT)
      vi.mocked(db.queryOne).mockResolvedValue(EXISTING_USER)
      vi.mocked(emailLib.sendOTPEmail).mockResolvedValue({ success: true } as any)

      const res = await sendOtpPOST(sendRequest({ email: 'user@example.com', isSignup: false }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toMatch(/sent/i)
      expect(body.email).toBe('user@example.com')
    })

    it('sets requiresPolicyAcceptance when policy version differs', async () => {
      vi.mocked(otpLib.checkSendOtpRateLimit).mockResolvedValue(ALLOWED_RATE_LIMIT)
      vi.mocked(db.queryOne).mockResolvedValue({ ...EXISTING_USER, policies_accepted_version: 'v0' })
      vi.mocked(emailLib.sendOTPEmail).mockResolvedValue({ success: true } as any)

      const res = await sendOtpPOST(sendRequest({ email: 'user@example.com', isSignup: false }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.requiresPolicyAcceptance).toBe(true)
    })
  })

  describe('signup flow (isSignup: true)', () => {
    it('returns 400 when email already registered on signup attempt', async () => {
      vi.mocked(otpLib.checkSendOtpRateLimit).mockResolvedValue(ALLOWED_RATE_LIMIT)
      vi.mocked(db.queryOne).mockResolvedValue({ id: 'existing-1' })

      const res = await sendOtpPOST(sendRequest({ email: 'taken@example.com', isSignup: true }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.userExists).toBe(true)
    })

    it('returns 200 with requiresPolicyAcceptance:true for new signup', async () => {
      vi.mocked(otpLib.checkSendOtpRateLimit).mockResolvedValue(ALLOWED_RATE_LIMIT)
      vi.mocked(db.queryOne).mockResolvedValue(null)
      vi.mocked(emailLib.sendOTPEmail).mockResolvedValue({ success: true } as any)

      const res = await sendOtpPOST(sendRequest({ email: 'new@example.com', isSignup: true }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.requiresPolicyAcceptance).toBe(true)
    })
  })

  describe('email delivery failure', () => {
    it('returns 500 when email sending fails', async () => {
      vi.mocked(otpLib.checkSendOtpRateLimit).mockResolvedValue(ALLOWED_RATE_LIMIT)
      vi.mocked(db.queryOne).mockResolvedValue(EXISTING_USER)
      vi.mocked(emailLib.sendOTPEmail).mockResolvedValue({ success: false } as any)

      const res = await sendOtpPOST(sendRequest({ email: 'user@example.com', isSignup: false }) as any)
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toMatch(/failed to send/i)
    })
  })
})

// ── verify-otp ───────────────────────────────────────────────────────────────

describe('POST /api/auth/verify-otp', () => {
  describe('missing fields', () => {
    it('returns 400 when email is missing', async () => {
      const res = await verifyOtpPOST(verifyRequest({ otp: '123456' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })

    it('returns 400 when otp is missing', async () => {
      const res = await verifyOtpPOST(verifyRequest({ email: 'user@example.com' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })
  })

  describe('wrong OTP', () => {
    it('returns 400 for invalid OTP', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: false, message: 'Invalid or expired OTP' })

      const res = await verifyOtpPOST(verifyRequest({ email: 'user@example.com', otp: '000000' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid or expired OTP')
    })

    it('returns 400 for expired OTP', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: false, message: 'OTP has expired' })

      const res = await verifyOtpPOST(verifyRequest({ email: 'user@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('OTP has expired')
    })
  })

  describe('correct OTP', () => {
    it('returns 200 with valid:true on correct OTP', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OTP verified' })

      const res = await verifyOtpPOST(verifyRequest({ email: 'user@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.valid).toBe(true)
      expect(body.message).toBe('OTP verified')
    })
  })
})
