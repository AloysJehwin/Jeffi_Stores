/**
 * Tests for:
 *   POST /api/business/login  (src/app/api/business/login/route.ts)
 *   POST /api/business/signup (src/app/api/business/signup/route.ts)
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

vi.mock('@/lib/auth/otp', () => ({
  verifyOTP: vi.fn(),
  isOTPVerified: vi.fn(),
  deleteOTP: vi.fn().mockResolvedValue(undefined),
  resetSendOtpCounter: vi.fn().mockResolvedValue(undefined),
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

import { POST as loginPOST } from '@/app/api/business/login/route'
import { POST as signupPOST } from '@/app/api/business/signup/route'
import * as otpLib from '@/lib/auth/otp'
import * as db from '@/lib/shared/db'

// ── helpers ───────────────────────────────────────────────────────────────────

function loginRequest(body: object) {
  return new Request('http://localhost/api/business/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function signupRequest(body: object) {
  return new Request('http://localhost/api/business/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const APPROVED_USER = {
  id: 'biz-1',
  email: 'biz@example.com',
  first_name: 'Biz',
  last_name: 'Owner',
  phone: '9876543210',
  is_active: true,
  policies_accepted_version: 'v1',
  approval_status: 'approved',
  company_name: 'Acme Ltd',
}

const VALID_SIGNUP_BODY = {
  email: 'newbiz@example.com',
  firstName: 'Biz',
  lastName: 'Owner',
  phone: '9876543210',
  companyName: 'Acme Ltd',
  gstNumber: '27AAPFU0939F1ZV',
  businessAddress: '123 Main St',
  industry: 'Retail',
}

const NEW_BIZ_USER = {
  id: 'biz-new-1',
  email: 'newbiz@example.com',
  first_name: 'Biz',
  last_name: 'Owner',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── POST /api/business/login ──────────────────────────────────────────────────

describe('POST /api/business/login', () => {
  describe('missing fields', () => {
    it('returns 400 when email is missing', async () => {
      const res = await loginPOST(loginRequest({ otp: '123456' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })

    it('returns 400 when otp is missing', async () => {
      const res = await loginPOST(loginRequest({ email: 'biz@example.com' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })
  })

  describe('OTP verification fails', () => {
    it('returns 400 when OTP is invalid', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: false, message: 'Invalid OTP' })

      const res = await loginPOST(loginRequest({ email: 'biz@example.com', otp: '000000' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Invalid OTP')
    })
  })

  describe('business account not found', () => {
    it('returns 404 when no business account exists for email', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue(null)

      const res = await loginPOST(loginRequest({ email: 'nobody@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.notBusinessAccount).toBe(true)
    })
  })

  describe('inactive account', () => {
    it('returns 403 for inactive business account', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue({ ...APPROVED_USER, is_active: false })

      const res = await loginPOST(loginRequest({ email: 'biz@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toMatch(/inactive/i)
    })
  })

  describe('pending approval', () => {
    it('returns 200 with approvalStatus:pending', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue({ ...APPROVED_USER, approval_status: 'pending' })

      const res = await loginPOST(loginRequest({ email: 'biz@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.approvalStatus).toBe('pending')
    })
  })

  describe('rejected application', () => {
    it('returns 200 with approvalStatus:rejected and rejection message', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue({ ...APPROVED_USER, approval_status: 'rejected' })

      const res = await loginPOST(loginRequest({ email: 'biz@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.approvalStatus).toBe('rejected')
      expect(body.message).toMatch(/not approved/i)
    })
  })

  describe('successful login (approved)', () => {
    it('returns 200 with user data for approved account', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue(APPROVED_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await loginPOST(loginRequest({ email: 'biz@example.com', otp: '123456' }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toBe('Login successful')
      expect(body.approvalStatus).toBe('approved')
      expect(body.user.id).toBe('biz-1')
      expect(body.user.companyName).toBe('Acme Ltd')
    })

    it('sets business_sid cookie on successful login', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue(APPROVED_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await loginPOST(loginRequest({ email: 'biz@example.com', otp: '123456' }) as any)
      const cookie = res.cookies.get('business_sid')
      expect(cookie?.value).toBeTruthy()
      expect(cookie?.httpOnly).toBe(true)
    })

    it('calls deleteOTP and resetSendOtpCounter after login', async () => {
      vi.mocked(otpLib.verifyOTP).mockResolvedValue({ valid: true, message: 'OK' })
      vi.mocked(db.queryOne).mockResolvedValue(APPROVED_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      await loginPOST(loginRequest({ email: 'biz@example.com', otp: '123456' }) as any)
      expect(otpLib.deleteOTP).toHaveBeenCalledWith('biz@example.com')
      expect(otpLib.resetSendOtpCounter).toHaveBeenCalledWith('biz@example.com')
    })
  })
})

// ── POST /api/business/signup ─────────────────────────────────────────────────

describe('POST /api/business/signup', () => {
  describe('missing required fields', () => {
    it('returns 400 when email is missing', async () => {
      const { email: _e, ...rest } = VALID_SIGNUP_BODY
      const res = await signupPOST(signupRequest(rest) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })

    it('returns 400 when companyName is missing', async () => {
      const { companyName: _c, ...rest } = VALID_SIGNUP_BODY
      const res = await signupPOST(signupRequest(rest) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })

    it('returns 400 when gstNumber is missing', async () => {
      const { gstNumber: _g, ...rest } = VALID_SIGNUP_BODY
      const res = await signupPOST(signupRequest(rest) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/required/i)
    })
  })

  describe('OTP not verified', () => {
    it('returns 400 when OTP has not been verified', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(false)

      const res = await signupPOST(signupRequest(VALID_SIGNUP_BODY) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/verify.*otp/i)
    })
  })

  describe('invalid phone number', () => {
    it('returns 400 for phone shorter than 10 digits', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)

      const res = await signupPOST(signupRequest({ ...VALID_SIGNUP_BODY, phone: '12345' }) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/10-digit/i)
    })
  })

  describe('duplicate business account', () => {
    it('returns 400 when a business account already exists for email', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValue({ id: 'existing-biz' })

      const res = await signupPOST(signupRequest(VALID_SIGNUP_BODY) as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/already exists/i)
    })
  })

  describe('successful signup', () => {
    it('returns 200 with approvalStatus:pending on successful signup', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_BIZ_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await signupPOST(signupRequest(VALID_SIGNUP_BODY) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toMatch(/created/i)
      expect(body.approvalStatus).toBe('pending')
      expect(body.user.id).toBe('biz-new-1')
    })

    it('inserts business_profiles row on successful signup', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_BIZ_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      await signupPOST(signupRequest(VALID_SIGNUP_BODY) as any)
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('business_profiles'),
        expect.arrayContaining(['biz-new-1', 'Acme Ltd'])
      )
    })

    it('sets business_sid cookie after signup', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_BIZ_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      await signupPOST(signupRequest(VALID_SIGNUP_BODY) as any)
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'business_sid',
        expect.any(String),
        expect.objectContaining({ httpOnly: true })
      )
    })

    it('deletes OTP and resets counter after signup', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_BIZ_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      await signupPOST(signupRequest(VALID_SIGNUP_BODY) as any)
      expect(otpLib.deleteOTP).toHaveBeenCalledWith('newbiz@example.com')
      expect(otpLib.resetSendOtpCounter).toHaveBeenCalledWith('newbiz@example.com')
    })

    it('normalises GST to uppercase in business_profiles insert', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(NEW_BIZ_USER)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      await signupPOST(signupRequest({ ...VALID_SIGNUP_BODY, gstNumber: 'lowercase123' }) as any)
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('business_profiles'),
        expect.arrayContaining(['LOWERCASE123'])
      )
    })
  })

  describe('DB insert fails', () => {
    it('returns 500 when INSERT returns null', async () => {
      vi.mocked(otpLib.isOTPVerified).mockResolvedValue(true)
      vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

      const res = await signupPOST(signupRequest(VALID_SIGNUP_BODY) as any)
      expect(res.status).toBe(500)
    })
  })
})
