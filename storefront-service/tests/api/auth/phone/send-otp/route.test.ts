import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const queryOne = vi.hoisted(() => vi.fn())
const otp = vi.hoisted(() => ({
  generateOTP: vi.fn(),
  storePhoneOTP: vi.fn(),
  checkSendPhoneOtpRateLimit: vi.fn(),
  recordSendPhoneOtp: vi.fn(),
}))
const deliverPhoneOtp = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/auth/otp', () => otp)
vi.mock('@/lib/auth/phone-otp-delivery', () => ({ deliverPhoneOtp }))
vi.mock('@/lib/shared/db', () => ({ queryOne }))

import { POST } from '@storefront/app/api/(public)/auth/phone/send-otp/route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/auth/phone/send-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

describe('POST /api/auth/phone/send-otp', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    queryOne.mockImplementation(async (sql: string) =>
      sql.includes('phone_verified = true') ? null : { email: 'a@b.test', first_name: 'Asha' }
    )
    otp.checkSendPhoneOtpRateLimit.mockResolvedValue({ allowed: true, nextCooldown: 60 })
    otp.generateOTP.mockReturnValue('123456')
    deliverPhoneOtp.mockResolvedValue('whatsapp')
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post({ phone: '9876543210' })).status).toBe(401)
    expect(deliverPhoneOtp).not.toHaveBeenCalled()
  })

  it('400s on an invalid phone number', async () => {
    const res = await post({ phone: '12345' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/10-digit/)
  })

  it('409s when another account already verified the number', async () => {
    queryOne.mockResolvedValueOnce({ id: 'other' })
    const res = await post({ phone: '9876543210' })
    expect(res.status).toBe(409)
    expect(otp.storePhoneOTP).not.toHaveBeenCalled()
  })

  it('429s with Retry-After when rate limited (lockout path)', async () => {
    otp.checkSendPhoneOtpRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 })
    const res = await post({ phone: '9876543210' })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    expect((await res.json()).retryAfter).toBe(42)
    expect(otp.storePhoneOTP).not.toHaveBeenCalled()
    expect(deliverPhoneOtp).not.toHaveBeenCalled()
  })

  it('stores and delivers the OTP, then records the send (+91 prefix normalised)', async () => {
    const res = await post({ phone: '+91 98765-43210' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'OTP sent', channel: 'whatsapp', nextCooldown: 60 })
    expect(otp.storePhoneOTP).toHaveBeenCalledWith('9876543210', '123456')
    expect(deliverPhoneOtp).toHaveBeenCalledWith({ phone: '9876543210', otp: '123456', email: 'a@b.test', name: 'Asha' })
    expect(otp.recordSendPhoneOtp).toHaveBeenCalledWith('9876543210')
  })

  it('500s without recording the send when no channel delivers', async () => {
    deliverPhoneOtp.mockResolvedValue(null)
    const res = await post({ phone: '9876543210' })
    expect(res.status).toBe(500)
    expect(otp.recordSendPhoneOtp).not.toHaveBeenCalled()
  })

  it('500s on an unexpected error', async () => {
    otp.storePhoneOTP.mockRejectedValue(new Error('redis'))
    expect((await post({ phone: '9876543210' })).status).toBe(500)
  })
})
