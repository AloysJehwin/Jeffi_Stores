import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const queryOne = vi.hoisted(() => vi.fn())
const verifyPhoneOTP = vi.hoisted(() => vi.fn())
const logActivity = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/auth/otp', () => ({ verifyPhoneOTP }))
vi.mock('@/lib/shared/db', () => ({ queryOne }))
vi.mock('@/lib/shared/activity', () => ({ logActivity }))

import { POST } from '@storefront/app/api/(public)/auth/phone/verify-otp/route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/auth/phone/verify-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

const updatedRow = {
  id: 'u1',
  email: 'a@b.test',
  first_name: 'Asha',
  last_name: 'K',
  phone: '9876543210',
  phone_verified: true,
}

describe('POST /api/auth/phone/verify-otp', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    verifyPhoneOTP.mockResolvedValue({ valid: true })
    queryOne.mockResolvedValue(updatedRow)
    logActivity.mockResolvedValue(undefined)
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post({ phone: '9876543210', otp: '1' })).status).toBe(401)
    expect(verifyPhoneOTP).not.toHaveBeenCalled()
  })

  it('400s when the phone or code is missing/invalid', async () => {
    expect((await post({ phone: '123', otp: '111111' })).status).toBe(400)
    expect((await post({ phone: '9876543210' })).status).toBe(400)
  })

  it('400s with the verifier message on a wrong or locked-out code', async () => {
    verifyPhoneOTP.mockResolvedValue({ valid: false, message: 'Too many attempts' })
    const res = await post({ phone: '9876543210', otp: '000000' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Too many attempts')
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('marks the phone verified on the user row and logs the activity', async () => {
    const res = await post({ phone: '+919876543210', otp: 123456 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      message: 'Mobile number verified',
      user: { id: 'u1', email: 'a@b.test', firstName: 'Asha', lastName: 'K', phone: '9876543210', phoneVerified: true },
    })
    expect(verifyPhoneOTP).toHaveBeenCalledWith('9876543210', '123456')
    const [sql, args] = queryOne.mock.calls[0]
    expect(sql).toContain('phone_verified = true')
    expect(args).toEqual(['9876543210', 'u1'])
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', kind: 'profile_updated' }))
  })

  it('409s when the number is already used by another account (unique violation)', async () => {
    queryOne.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))
    expect((await post({ phone: '9876543210', otp: '123456' })).status).toBe(409)
  })

  it('500s when no row was updated or on other errors', async () => {
    queryOne.mockResolvedValue(null)
    expect((await post({ phone: '9876543210', otp: '123456' })).status).toBe(500)
    queryOne.mockRejectedValue(new Error('db'))
    expect((await post({ phone: '9876543210', otp: '123456' })).status).toBe(500)
  })
})
