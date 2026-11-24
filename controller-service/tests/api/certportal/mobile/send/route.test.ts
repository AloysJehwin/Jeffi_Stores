import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const session = vi.hoisted(() => ({ verifyPortalToken: vi.fn(), PORTAL_COOKIE: 'portal' }))
vi.mock('@/lib/auth/portal-session', () => session)
const cm = vi.hoisted(() => ({ downloadableCert: vi.fn(), inCertStore: vi.fn() }))
vi.mock('@controller/lib/auth/cert-mobile', () => cm)
const mobile = vi.hoisted(() => ({ sendAdminMobileCode: vi.fn() }))
vi.mock('@/lib/auth/admin-mobile', () => mobile)

import { POST } from '@controller/app/api/(public)/certportal/mobile/send/route'

const call = (body: unknown, cookie: string | null = 'portal=tok') =>
  POST(
    new NextRequest('http://localhost/api/certportal/mobile/send', {
      method: 'POST',
      headers: cookie ? { cookie } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
const good = { serial: 'S1', phone: '+919999999999' }

beforeEach(() => {
  vi.clearAllMocks()
  session.verifyPortalToken.mockResolvedValue({ email: 'a@b.co', name: null })
  cm.downloadableCert.mockResolvedValue({ tenant_id: 't-1', store_name: 'Acme' })
  cm.inCertStore.mockImplementation(async (_t: string, _s: string, _e: string, fn: (c: unknown) => unknown) =>
    fn({ store: 'store-db', storeName: 'Acme', admin: { id: 'adm-1' } })
  )
  mobile.sendAdminMobileCode.mockResolvedValue({ ok: true, channel: 'sms', retryAfter: 30 })
})

describe('POST /api/certportal/mobile/send', () => {
  it('401s when not signed in', async () => {
    session.verifyPortalToken.mockResolvedValue(null)
    expect((await call(good, null)).status).toBe(401)
    expect(cm.downloadableCert).not.toHaveBeenCalled()
  })

  it('401s when the token check throws', async () => {
    session.verifyPortalToken.mockRejectedValue(new Error('bad jwt'))
    expect((await call(good)).status).toBe(401)
  })

  it('400s for a bad body', async () => {
    expect((await call({ serial: 'S1', phone: '1' })).status).toBe(400)
    expect((await call('not json')).status).toBe(400)
    expect(mobile.sendAdminMobileCode).not.toHaveBeenCalled()
  })

  it('404s when the certificate is not this account\'s', async () => {
    cm.downloadableCert.mockResolvedValue(null)
    expect((await call(good)).status).toBe(404)
    expect(cm.downloadableCert).toHaveBeenCalledWith('S1', 'a@b.co')
  })

  it('404s when the store has no active admin', async () => {
    cm.inCertStore.mockResolvedValue(null)
    expect((await call(good)).status).toBe(404)
  })

  it('sends the code to the number entered', async () => {
    const res = await call(good)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ channel: 'sms', retryAfter: 30 })
    expect(mobile.sendAdminMobileCode).toHaveBeenCalledWith('store-db', 'adm-1', '+919999999999', 'Acme')
  })

  it('relays a sender failure with its status', async () => {
    mobile.sendAdminMobileCode.mockResolvedValue({ ok: false, error: 'Wait a bit', retryAfter: 20, status: 429 })
    const res = await call(good)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Wait a bit', retryAfter: 20 })
  })
})
