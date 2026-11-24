import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/admin-mobile', () => ({ sendAdminMobileCode: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ currentBrandNameAsync: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/account/mobile/send-otp/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { sendAdminMobileCode } from '@/lib/auth/admin-mobile'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { currentBrandNameAsync } from '@/lib/catalog/brand'

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/account/mobile/send-otp', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('POST /api/admin/account/mobile/send-otp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
    vi.mocked(currentBrandNameAsync).mockResolvedValue('Acme')
  })

  it('401s without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ phone: '+919876543210' }))).status).toBe(401)
    expect(sendAdminMobileCode).not.toHaveBeenCalled()
  })

  it('400s on a short phone or bad json', async () => {
    expect((await POST(req({ phone: '12' }))).status).toBe(400)
    expect((await POST(req('not json'))).status).toBe(400)
    expect(sendAdminMobileCode).not.toHaveBeenCalled()
  })

  it('sends the code and returns the channel', async () => {
    vi.mocked(sendAdminMobileCode).mockResolvedValue({ ok: true, channel: 'sms', retryAfter: 30 } as any)
    const res = await POST(req({ phone: '+919876543210' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ channel: 'sms', retryAfter: 30 })
    expect(sendAdminMobileCode).toHaveBeenCalledWith('t1', 'a1', '+919876543210', 'Acme')
  })

  it('falls back to a null tenant when resolution fails', async () => {
    vi.mocked(resolveTenantId).mockRejectedValue(new Error('no tenant'))
    vi.mocked(sendAdminMobileCode).mockResolvedValue({ ok: true, channel: 'whatsapp', retryAfter: 0 } as any)
    await POST(req({ phone: '+919876543210' }))
    expect(sendAdminMobileCode).toHaveBeenCalledWith(null, 'a1', '+919876543210', 'Acme')
  })

  it('relays a rate-limit failure', async () => {
    vi.mocked(sendAdminMobileCode).mockResolvedValue({ ok: false, error: 'Wait', status: 429, retryAfter: 45 } as any)
    const res = await POST(req({ phone: '+919876543210' }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Wait', retryAfter: 45 })
  })
})
