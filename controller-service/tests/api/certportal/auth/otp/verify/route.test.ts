import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const otp = vi.hoisted(() => ({ verifyOTP: vi.fn(), deleteOTP: vi.fn(), resetSendOtpCounter: vi.fn() }))
vi.mock('@/lib/auth/otp', () => otp)
const session = vi.hoisted(() => ({ issuePortalToken: vi.fn(), setPortalCookie: vi.fn() }))
vi.mock('@/lib/auth/portal-session', () => session)

import { POST } from '@controller/app/api/(public)/certportal/auth/otp/verify/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/certportal/auth/otp/verify', { method: 'POST', headers: { 'x-forwarded-host': 'cert.test' }, body: typeof body === 'string' ? body : JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  otp.verifyOTP.mockResolvedValue({ valid: true })
  otp.deleteOTP.mockResolvedValue(undefined)
  otp.resetSendOtpCounter.mockResolvedValue(undefined)
  session.issuePortalToken.mockResolvedValue('tok')
  session.setPortalCookie.mockImplementation((res: Response) => res)
})

describe('POST /api/certportal/auth/otp/verify', () => {
  it.each([[{}], [{ email: 'a@b.co' }], [{ code: '1' }], [{ email: 'a@b.co', code: 123456 }], ['not json']])('400s for bad input %#', async body => {
    expect((await call(body)).status).toBe(400)
    expect(otp.verifyOTP).not.toHaveBeenCalled()
  })

  it('401s for a wrong code with the checker message', async () => {
    otp.verifyOTP.mockResolvedValue({ valid: false, message: 'Too many attempts' })
    const res = await call({ email: 'a@b.co', code: '000000' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Too many attempts' })
    expect(session.issuePortalToken).not.toHaveBeenCalled()
    expect(otp.deleteOTP).not.toHaveBeenCalled()
  })

  it('signs in on a valid code, consuming it and clearing the resend backoff', async () => {
    const res = await call({ email: 'Ada@Example.com', code: ' 123456 ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'ada@example.com' })
    expect(otp.verifyOTP).toHaveBeenCalledWith('certportal:ada@example.com', '123456')
    expect(otp.deleteOTP).toHaveBeenCalledWith('certportal:ada@example.com')
    expect(otp.resetSendOtpCounter).toHaveBeenCalledWith('certportal:ada@example.com')
    expect(session.setPortalCookie).toHaveBeenCalledWith(expect.anything(), 'tok', 'cert.test')
  })

  it('still signs in when resetting the counter fails', async () => {
    otp.resetSendOtpCounter.mockRejectedValue(new Error('redis'))
    expect((await call({ email: 'a@b.co', code: '123456' })).status).toBe(200)
  })

  it('answers 500 when the checker throws', async () => {
    otp.verifyOTP.mockRejectedValue(new Error('redis'))
    expect((await call({ email: 'a@b.co', code: '123456' })).status).toBe(500)
  })
})
