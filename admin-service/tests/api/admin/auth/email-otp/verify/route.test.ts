import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/otp', () => ({ verifyOTP: vi.fn(), deleteOTP: vi.fn(), resetSendOtpCounter: vi.fn() }))
vi.mock('@/lib/auth/mfa', () => ({ issueMfaTicket: vi.fn() }))
vi.mock('@/lib/auth/admin-identity', () => ({ resolveAdminByEmail: vi.fn(), enforceCertGate: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/auth/email-otp/verify/route'
import { verifyOTP, deleteOTP, resetSendOtpCounter } from '@/lib/auth/otp'
import { issueMfaTicket } from '@/lib/auth/mfa'
import { resolveAdminByEmail, enforceCertGate } from '@/lib/auth/admin-identity'
import { logActivity } from '@/lib/shared/activity'

const req = (body: unknown) => new NextRequest('http://localhost/api/admin/auth/email-otp/verify', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const ok = { email: 'a@x.in', code: '654321' }

describe('POST /api/admin/auth/email-otp/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
    vi.mocked(verifyOTP).mockResolvedValue({ valid: true } as any)
    vi.mocked(resolveAdminByEmail).mockResolvedValue({ id: 'a1', user_id: 'u1', mfa_enabled: true } as any)
    vi.mocked(enforceCertGate).mockResolvedValue({ ok: true, certCN: 'cn' } as any)
    vi.mocked(issueMfaTicket).mockResolvedValue('tkt' as any)
    vi.mocked(resetSendOtpCounter).mockResolvedValue(undefined as any)
    vi.mocked(logActivity).mockResolvedValue(undefined as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('400s without email or code', async () => {
    expect((await POST(req({ email: 'a@x.in' }))).status).toBe(400)
    expect((await POST(req('bad'))).status).toBe(400)
  })

  it('401s on a wrong or expired code and issues no ticket', async () => {
    vi.mocked(verifyOTP).mockResolvedValue({ valid: false, message: 'Too many attempts' } as any)
    const res = await POST(req(ok))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Too many attempts' })
    expect(issueMfaTicket).not.toHaveBeenCalled()
  })

  it('401s when the admin no longer resolves', async () => {
    vi.mocked(resolveAdminByEmail).mockResolvedValue(null as any)
    expect((await POST(req(ok))).status).toBe(401)
    expect(deleteOTP).not.toHaveBeenCalled()
  })

  it('relays a cert gate failure before consuming the code', async () => {
    vi.mocked(enforceCertGate).mockResolvedValue({ ok: false, error: 'cert', status: 403 } as any)
    expect((await POST(req(ok))).status).toBe(403)
    expect(deleteOTP).not.toHaveBeenCalled()
  })

  it('issues a verify ticket for an MFA admin, consumes the code and resets the cooldown', async () => {
    const res = await POST(req(ok))
    expect(await res.json()).toEqual({ mfa_required: true, ticket: 'tkt' })
    expect(issueMfaTicket).toHaveBeenCalledWith({ adminId: 'a1', purpose: 'verify', certCN: 'cn' })
    expect(deleteOTP).toHaveBeenCalledWith('a@x.in')
    expect(resetSendOtpCounter).toHaveBeenCalledWith('a@x.in')
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', kind: 'login' }))
  })

  it('issues an enroll ticket when MFA is not enabled', async () => {
    vi.mocked(resolveAdminByEmail).mockResolvedValue({ id: 'a1', user_id: 'u1', mfa_enabled: false } as any)
    expect(await (await POST(req(ok))).json()).toEqual({ enroll_required: true, ticket: 'tkt' })
    expect(issueMfaTicket).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'enroll' }))
  })

  it('accepts the dev OTP only outside production, without touching the store', async () => {
    const dev = { email: 'a@x.in', code: '000000' }
    vi.mocked(verifyOTP).mockResolvedValue({ valid: false } as any)
    expect((await POST(req(dev))).status).toBe(401)
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ADMIN_DEV_OTP', '')
    vi.mocked(verifyOTP).mockClear()
    expect((await POST(req(dev))).status).toBe(200)
    expect(verifyOTP).not.toHaveBeenCalled()
    expect(deleteOTP).not.toHaveBeenCalled()
  })

  it('500s on an unexpected error', async () => {
    vi.mocked(issueMfaTicket).mockRejectedValue(new Error('redis'))
    expect((await POST(req(ok))).status).toBe(500)
  })
})
