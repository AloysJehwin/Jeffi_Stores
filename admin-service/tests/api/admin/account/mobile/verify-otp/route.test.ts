import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/admin-mobile', () => ({ verifyAdminMobileCode: vi.fn(), maskMobile: vi.fn((m: string) => `***${m.slice(-4)}`) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/account/mobile/verify-otp/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { verifyAdminMobileCode } from '@/lib/auth/admin-mobile'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

const req = (body: unknown) => new NextRequest('http://localhost/api/admin/account/mobile/verify-otp', { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/admin/account/mobile/verify-otp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
  })

  it('401s without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ otp: '123456' }))).status).toBe(401)
    expect(verifyAdminMobileCode).not.toHaveBeenCalled()
  })

  it('400s on a malformed code', async () => {
    for (const otp of ['12345', 'abcdef', '1234567']) expect((await POST(req({ otp }))).status).toBe(400)
    expect(verifyAdminMobileCode).not.toHaveBeenCalled()
  })

  it('verifies and returns the masked number', async () => {
    vi.mocked(verifyAdminMobileCode).mockResolvedValue({ ok: true, phone: '+919876543210' } as any)
    const res = await POST(req({ otp: '123456' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mobile: '***3210' })
    expect(verifyAdminMobileCode).toHaveBeenCalledWith('t1', 'a1', '123456')
  })

  it('relays a wrong or expired code', async () => {
    vi.mocked(verifyAdminMobileCode).mockResolvedValue({ ok: false, error: 'Invalid or expired code', status: 400 } as any)
    const res = await POST(req({ otp: '000000' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid or expired code' })
  })

  it('relays a lockout', async () => {
    vi.mocked(verifyAdminMobileCode).mockResolvedValue({ ok: false, error: 'Too many attempts', status: 429 } as any)
    expect((await POST(req({ otp: '000000' }))).status).toBe(429)
  })
})
