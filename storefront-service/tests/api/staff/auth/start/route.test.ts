import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const otp = vi.hoisted(() => ({
  generateOTP: vi.fn(),
  storeOTP: vi.fn(),
  checkSendOtpRateLimit: vi.fn(),
  recordSendOtp: vi.fn(),
}))
const sendAdminOTPEmail = vi.hoisted(() => vi.fn())
const resolveAdminByEmail = vi.hoisted(() => vi.fn())
const hasPlanScope = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/otp', () => otp)
vi.mock('@/lib/email', () => ({ sendAdminOTPEmail }))
vi.mock('@/lib/auth/admin-identity', () => ({ resolveAdminByEmail }))
vi.mock('@/lib/auth/plan-gate', () => ({ hasPlanScope }))

import { POST } from '@storefront/app/api/(public)/staff/auth/start/route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/staff/auth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

describe('POST /api/staff/auth/start', () => {
  beforeEach(() => {
    otp.checkSendOtpRateLimit.mockResolvedValue({ allowed: true, nextCooldown: 30 })
    otp.generateOTP.mockReturnValue('654321')
    resolveAdminByEmail.mockResolvedValue({ id: 'a1', role: 'staff', scopes: [], first_name: 'Ravi' })
    hasPlanScope.mockResolvedValue(true)
  })

  it('400s on a missing or malformed email', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ email: 'not-an-email' })).status).toBe(400)
    expect((await post('{bad')).status).toBe(400)
    expect(otp.checkSendOtpRateLimit).not.toHaveBeenCalled()
  })

  it('429s with Retry-After when the send rate limit is hit (lockout)', async () => {
    otp.checkSendOtpRateLimit.mockResolvedValue({ allowed: false, retryAfter: 90 })
    const res = await post({ email: 'staff@x.test' })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('90')
    expect(sendAdminOTPEmail).not.toHaveBeenCalled()
  })

  it('404s for an email that is not an admin of this store', async () => {
    resolveAdminByEmail.mockResolvedValue(null)
    expect((await post({ email: 'x@y.test' })).status).toBe(404)
    expect(otp.storeOTP).not.toHaveBeenCalled()
  })

  it('403s when the role or plan cannot write customer notes', async () => {
    hasPlanScope.mockResolvedValue(false)
    expect((await post({ email: 'staff@x.test' })).status).toBe(403)
    expect(hasPlanScope).toHaveBeenCalledWith('staff', [], 'customers:write')
    expect(sendAdminOTPEmail).not.toHaveBeenCalled()
  })

  it('stores the code under the staff namespace, emails it and records the send', async () => {
    const res = await post({ email: 'Staff@X.test' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ nextCooldown: 30 })
    expect(otp.checkSendOtpRateLimit).toHaveBeenCalledWith('staff:staff@x.test')
    expect(otp.storeOTP).toHaveBeenCalledWith('staff:staff@x.test', '654321')
    expect(sendAdminOTPEmail).toHaveBeenCalledWith('Staff@X.test', '654321', 'Ravi')
    expect(otp.recordSendOtp).toHaveBeenCalledWith('staff:staff@x.test')
  })

  it('500s without recording the send when the email fails', async () => {
    sendAdminOTPEmail.mockRejectedValue(new Error('smtp'))
    expect((await post({ email: 'staff@x.test' })).status).toBe(500)
    expect(otp.recordSendOtp).not.toHaveBeenCalled()
  })
})
