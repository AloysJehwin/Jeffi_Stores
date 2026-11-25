import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const session = vi.hoisted(() => ({ verifyPortalToken: vi.fn(), PORTAL_COOKIE: 'portal' }))
vi.mock('@/lib/auth/portal-session', () => session)
const cm = vi.hoisted(() => ({ downloadableCert: vi.fn(), inCertStore: vi.fn() }))
vi.mock('@controller/lib/auth/cert-mobile', () => cm)
const mobile = vi.hoisted(() => ({ verifyAdminMobileCode: vi.fn(), maskMobile: vi.fn((p: string) => `***${p.slice(-2)}`) }))
vi.mock('@/lib/auth/admin-mobile', () => mobile)

import { POST } from '@controller/app/api/(public)/certportal/mobile/verify/route'

const call = (body: unknown, cookie: string | null = 'portal=tok') =>
  POST(
    new NextRequest('http://localhost/api/certportal/mobile/verify', {
      method: 'POST',
      headers: cookie ? { cookie } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
const good = { serial: 'S1', otp: '123456' }

beforeEach(() => {
  vi.clearAllMocks()
  session.verifyPortalToken.mockResolvedValue({ email: 'a@b.co', name: null })
  cm.downloadableCert.mockResolvedValue({ tenant_id: 't-1', store_name: 'Acme' })
  cm.inCertStore.mockImplementation(async (_t: string, _s: string, _e: string, fn: (c: unknown) => unknown) => fn({ store: 'store-db', admin: { id: 'adm-1' } }))
  mobile.verifyAdminMobileCode.mockResolvedValue({ ok: true, phone: '+919999999999' })
})

describe('POST /api/certportal/mobile/verify', () => {
  it('401s when not signed in', async () => {
    session.verifyPortalToken.mockResolvedValue(null)
    expect((await call(good, null)).status).toBe(401)
    expect(mobile.verifyAdminMobileCode).not.toHaveBeenCalled()
  })

  it.each([[{ serial: 'S1', otp: '12345' }], [{ serial: 'S1', otp: 'abcdef' }], [{ otp: '123456' }], ['not json']])('400s for a bad body %#', async body => {
    expect((await call(body)).status).toBe(400)
  })

  it('404s for a certificate that is not this account\'s', async () => {
    cm.downloadableCert.mockResolvedValue(null)
    expect((await call(good)).status).toBe(404)
  })

  it('404s when the store has no active admin', async () => {
    cm.inCertStore.mockResolvedValue(null)
    expect((await call(good)).status).toBe(404)
  })

  it('verifies the code and answers with a masked number', async () => {
    const res = await call(good)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ verified: true, mobileHint: '***99' })
    expect(mobile.verifyAdminMobileCode).toHaveBeenCalledWith('store-db', 'adm-1', '123456')
  })

  it('relays a wrong code with its status', async () => {
    mobile.verifyAdminMobileCode.mockResolvedValue({ ok: false, error: 'Wrong code', status: 400 })
    const res = await call(good)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Wrong code' })
  })
})
