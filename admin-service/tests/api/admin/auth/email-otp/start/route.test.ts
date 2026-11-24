import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/otp', () => ({ generateOTP: vi.fn(), storeOTP: vi.fn(), checkSendOtpRateLimit: vi.fn(), recordSendOtp: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendAdminOTPEmail: vi.fn() }))
vi.mock('@/lib/auth/admin-identity', () => ({ resolveAdminByEmail: vi.fn(), enforceCertGate: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/auth/email-otp/start/route'
import { generateOTP, storeOTP, checkSendOtpRateLimit, recordSendOtp } from '@/lib/auth/otp'
import { sendAdminOTPEmail } from '@/lib/email'
import { resolveAdminByEmail, enforceCertGate } from '@/lib/auth/admin-identity'

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/admin/auth/email-otp/start', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers })

describe('POST /api/admin/auth/email-otp/start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkSendOtpRateLimit).mockResolvedValue({ allowed: true, nextCooldown: 60 } as any)
    vi.mocked(resolveAdminByEmail).mockResolvedValue({ id: 'a1', first_name: 'Ann' } as any)
    vi.mocked(enforceCertGate).mockResolvedValue({ ok: true, certCN: 'cn' } as any)
    vi.mocked(generateOTP).mockReturnValue('123456')
  })

  it('400s on a missing or malformed email', async () => {
    expect((await POST(req({}))).status).toBe(400)
    expect((await POST(req({ email: 'nope' }))).status).toBe(400)
    expect((await POST(req('bad json'))).status).toBe(400)
    expect(sendAdminOTPEmail).not.toHaveBeenCalled()
  })

  it('429s with Retry-After when rate limited', async () => {
    vi.mocked(checkSendOtpRateLimit).mockResolvedValue({ allowed: false, retryAfter: 42 } as any)
    const res = await POST(req({ email: 'a@x.in' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(storeOTP).not.toHaveBeenCalled()
  })

  it('404s for an unknown admin without sending mail', async () => {
    vi.mocked(resolveAdminByEmail).mockResolvedValue(null as any)
    expect((await POST(req({ email: 'a@x.in' }))).status).toBe(404)
    expect(sendAdminOTPEmail).not.toHaveBeenCalled()
  })

  it('relays a cert gate failure', async () => {
    vi.mocked(enforceCertGate).mockResolvedValue({ ok: false, error: 'cert', status: 403 } as any)
    const res = await POST(req({ email: 'a@x.in' }))
    expect(res.status).toBe(403)
    expect(storeOTP).not.toHaveBeenCalled()
  })

  it('stores the code, emails it and records the send', async () => {
    const res = await POST(req({ email: 'a@x.in' }, { 'x-client-cert-cn': 'cn', 'x-client-cert-serial': 's1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ nextCooldown: 60 })
    expect(enforceCertGate).toHaveBeenCalledWith(expect.anything(), 'cn', 's1')
    expect(storeOTP).toHaveBeenCalledWith('a@x.in', '123456')
    expect(sendAdminOTPEmail).toHaveBeenCalledWith('a@x.in', '123456', 'Ann')
    expect(recordSendOtp).toHaveBeenCalledWith('a@x.in')
  })

  it('500s when mail sending fails', async () => {
    vi.mocked(sendAdminOTPEmail).mockRejectedValue(new Error('smtp'))
    expect((await POST(req({ email: 'a@x.in' }))).status).toBe(500)
    expect(recordSendOtp).not.toHaveBeenCalled()
  })
})
