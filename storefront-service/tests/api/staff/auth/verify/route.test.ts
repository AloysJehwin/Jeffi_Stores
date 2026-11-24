import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const otp = vi.hoisted(() => ({ verifyOTP: vi.fn(), deleteOTP: vi.fn(), resetSendOtpCounter: vi.fn() }))
const resolveAdminByEmail = vi.hoisted(() => vi.fn())
const resolveTenantId = vi.hoisted(() => vi.fn())
const issueStaffToken = vi.hoisted(() => vi.fn())
const setStaffCookie = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/otp', () => otp)
vi.mock('@/lib/auth/admin-identity', () => ({ resolveAdminByEmail }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))
vi.mock('@/lib/auth/staff-session', () => ({ issueStaffToken, setStaffCookie }))

import { POST } from '@storefront/app/api/(public)/staff/auth/verify/route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/staff/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

describe('POST /api/staff/auth/verify', () => {
  beforeEach(() => {
    otp.verifyOTP.mockResolvedValue({ valid: true })
    otp.resetSendOtpCounter.mockResolvedValue(undefined)
    resolveAdminByEmail.mockResolvedValue({ id: 'a1', email: 'staff@x.test', first_name: 'Ravi', last_name: 'K' })
    resolveTenantId.mockResolvedValue('t1')
    issueStaffToken.mockResolvedValue('staff-token')
    setStaffCookie.mockImplementation((res: NextResponse, token: string) => {
      res.headers.set('x-test-cookie', token)
      return res
    })
  })

  it('400s when the email or code is missing or not a string', async () => {
    expect((await post({ email: 'a@b.test' })).status).toBe(400)
    expect((await post({ code: '1' })).status).toBe(400)
    expect((await post({ email: 'a@b.test', code: 123456 })).status).toBe(400)
    expect((await post('{bad')).status).toBe(400)
    expect(otp.verifyOTP).not.toHaveBeenCalled()
  })

  it('401s with the verifier message on a wrong or locked-out code and issues no session', async () => {
    otp.verifyOTP.mockResolvedValue({ valid: false, message: 'Too many attempts' })
    const res = await post({ email: 'staff@x.test', code: '000000' })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Too many attempts')
    expect(issueStaffToken).not.toHaveBeenCalled()
    expect(otp.deleteOTP).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the verifier gives none', async () => {
    otp.verifyOTP.mockResolvedValue({ valid: false })
    expect((await (await post({ email: 'staff@x.test', code: '1' })).json()).error).toBe('Invalid or expired code')
  })

  it('burns the code, resets the resend cooldown and issues the staff session cookie', async () => {
    const res = await post({ email: 'Staff@X.test', code: ' 123456 ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, name: 'Ravi K' })
    expect(otp.verifyOTP).toHaveBeenCalledWith('staff:staff@x.test', '123456')
    expect(otp.deleteOTP).toHaveBeenCalledWith('staff:staff@x.test')
    expect(otp.resetSendOtpCounter).toHaveBeenCalledWith('staff:staff@x.test')
    expect(issueStaffToken).toHaveBeenCalledWith({ adminId: 'a1', tenantId: 't1', email: 'staff@x.test', name: 'Ravi K' })
    expect(res.headers.get('x-test-cookie')).toBe('staff-token')
  })

  it('is single-use: a replay after the code was deleted is rejected', async () => {
    await post({ email: 'staff@x.test', code: '123456' })
    otp.verifyOTP.mockResolvedValue({ valid: false, message: 'Invalid or expired code' })
    expect((await post({ email: 'staff@x.test', code: '123456' })).status).toBe(401)
    expect(issueStaffToken).toHaveBeenCalledTimes(1)
  })

  it('still signs in when the cooldown reset fails', async () => {
    otp.resetSendOtpCounter.mockRejectedValue(new Error('redis'))
    expect((await post({ email: 'staff@x.test', code: '123456' })).status).toBe(200)
  })

  it('404s when the admin no longer exists', async () => {
    resolveAdminByEmail.mockResolvedValue(null)
    expect((await post({ email: 'staff@x.test', code: '123456' })).status).toBe(404)
    expect(issueStaffToken).not.toHaveBeenCalled()
  })

  it('500s on an unexpected error', async () => {
    issueStaffToken.mockRejectedValue(new Error('jwt'))
    expect((await post({ email: 'staff@x.test', code: '123456' })).status).toBe(500)
  })
})
