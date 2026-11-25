import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockVerify, mockDelete, mockReset, mockIssue } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockDelete: vi.fn(),
  mockReset: vi.fn(),
  mockIssue: vi.fn(),
}))

vi.mock('@/lib/auth/otp', () => ({ verifyOTP: mockVerify, deleteOTP: mockDelete, resetSendOtpCounter: mockReset }))
vi.mock('@/lib/auth/owner-session', () => ({
  issueOwnerSession: mockIssue,
  setOwnerCookie: (res: NextResponse, sid: string) => { res.cookies.set('owner_sid', sid); return res },
}))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))

import { POST } from '@controller/app/api/(ecom)/ecom/auth/verify-otp/route'

const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/auth/verify-otp', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('POST /api/ecom/auth/verify-otp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s when email or otp is missing', async () => {
    expect((await POST(req({ email: 'o@acme.test' }))).status).toBe(400)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('400s a wrong code with the checker message and issues no session', async () => {
    mockVerify.mockResolvedValue({ valid: false, message: 'Invalid OTP' })
    const res = await POST(req({ email: 'o@acme.test', otp: '000000' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid OTP')
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('signs in, burns the code and resets the send counter', async () => {
    mockVerify.mockResolvedValue({ valid: true })
    mockIssue.mockResolvedValue({ sid: 'sid-1', owner: { id: 'o-1', email: 'o@acme.test', name: 'Priya' } })
    const res = await POST(req({ email: 'o@acme.test', otp: '123456', name: 'Priya' }))
    expect(res.status).toBe(200)
    expect((await res.json()).owner.id).toBe('o-1')
    expect(mockIssue).toHaveBeenCalledWith({ email: 'o@acme.test', name: 'Priya', signals: {} })
    expect(mockDelete).toHaveBeenCalledWith('o@acme.test')
    expect(mockReset).toHaveBeenCalledWith('o@acme.test')
    expect(res.cookies.get('owner_sid')?.value).toBe('sid-1')
  })

  it('500s when the session cannot be issued and keeps the code', async () => {
    mockVerify.mockResolvedValue({ valid: true })
    mockIssue.mockRejectedValue(new Error('db'))
    expect((await POST(req({ email: 'o@acme.test', otp: '123456' }))).status).toBe(500)
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
