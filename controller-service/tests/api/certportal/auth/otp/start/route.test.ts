import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const otp = vi.hoisted(() => ({
  generateOTP: vi.fn(),
  storeOTP: vi.fn(),
  checkSendOtpRateLimit: vi.fn(),
  recordSendOtp: vi.fn(),
}))
vi.mock('@/lib/auth/otp', () => otp)
const mail = vi.hoisted(() => ({ sendAdminOTPEmail: vi.fn() }))
vi.mock('@/lib/email', () => mail)

import { POST } from '@controller/app/api/(public)/certportal/auth/otp/start/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/certportal/auth/otp/start', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  otp.generateOTP.mockReturnValue('123456')
  otp.checkSendOtpRateLimit.mockResolvedValue({ allowed: true, nextCooldown: 60 })
  otp.storeOTP.mockResolvedValue(undefined)
  otp.recordSendOtp.mockResolvedValue(undefined)
  mail.sendAdminOTPEmail.mockResolvedValue(undefined)
})

describe('POST /api/certportal/auth/otp/start', () => {
  it.each([[{}], [{ email: 5 }], [{ email: 'not-an-email' }], ['not json']])('400s for bad input %#', async body => {
    const res = await call(body)
    expect(res.status).toBe(400)
    expect(mail.sendAdminOTPEmail).not.toHaveBeenCalled()
  })

  it('429s with Retry-After while rate limited, sending nothing', async () => {
    otp.checkSendOtpRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 })
    const res = await call({ email: 'a@b.co' })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(otp.storeOTP).not.toHaveBeenCalled()
    expect(mail.sendAdminOTPEmail).not.toHaveBeenCalled()
  })

  it('stores a code under a lower-cased key, mails it, and records the send', async () => {
    const res = await call({ email: 'Ada@Example.com' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ nextCooldown: 60 })
    expect(otp.checkSendOtpRateLimit).toHaveBeenCalledWith('certportal:ada@example.com')
    expect(otp.storeOTP).toHaveBeenCalledWith('certportal:ada@example.com', '123456')
    expect(mail.sendAdminOTPEmail).toHaveBeenCalledWith('Ada@Example.com', '123456')
    expect(otp.recordSendOtp).toHaveBeenCalledWith('certportal:ada@example.com')
  })

  it('answers 500 and records nothing when the mail fails', async () => {
    mail.sendAdminOTPEmail.mockRejectedValue(new Error('smtp'))
    const res = await call({ email: 'a@b.co' })
    expect(res.status).toBe(500)
    expect(otp.recordSendOtp).not.toHaveBeenCalled()
  })
})
