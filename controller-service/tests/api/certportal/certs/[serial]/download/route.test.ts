import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const session = vi.hoisted(() => ({ verifyPortalToken: vi.fn(), PORTAL_COOKIE: 'portal' }))
vi.mock('@/lib/auth/portal-session', () => session)
const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
const crypt = vi.hoisted(() => ({ decryptPortalSecret: vi.fn() }))
vi.mock('@/lib/tenancy/portal-certs', () => crypt)
const cm = vi.hoisted(() => ({ certNeedsMobileCheck: vi.fn(), downloadableCert: vi.fn(), inCertStore: vi.fn() }))
vi.mock('@controller/lib/auth/cert-mobile', () => cm)

import { GET } from '@controller/app/api/(public)/certportal/certs/[serial]/download/route'

const call = (cookie: string | null = 'portal=tok') =>
  GET(new NextRequest('http://localhost/api/certportal/certs/S1/download', { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ serial: 'S1' }),
  })
const future = new Date(Date.now() + 86_400_000).toISOString()
const past = new Date(Date.now() - 86_400_000).toISOString()
// Placeholder sealed and opened values for the mocked decryptPortalSecret.
const SEALED_FILE = 'sealed-file'
const SEALED_PIN = 'sealed-pin'
const OPENED_PIN = 'opened-pin'

beforeEach(() => {
  vi.clearAllMocks()
  session.verifyPortalToken.mockResolvedValue({ email: 'a@b.co' })
  cm.certNeedsMobileCheck.mockReturnValue(false)
  crypt.decryptPortalSecret.mockImplementation((v: string) => (v === SEALED_FILE ? Buffer.from('P12BYTES').toString('base64') : OPENED_PIN))
  query.mockResolvedValue({ rows: [{ p12_data_enc: SEALED_FILE, p12_password_enc: SEALED_PIN, common_name: 'ada admin/1' }] })
})

describe('GET /api/certportal/certs/[serial]/download', () => {
  it('401s when not signed in', async () => {
    session.verifyPortalToken.mockResolvedValue(null)
    expect((await call(null)).status).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('claims the download for the signed-in email and returns the file once', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-pkcs12')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="ada_admin_1.p12"')
    expect(res.headers.get('X-Cert-Password')).toBe(OPENED_PIN)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('P12BYTES')
    expect(query.mock.calls[0][0]).toContain('downloaded_at IS NULL')
    expect(query.mock.calls[0][1]).toEqual(['S1', 'a@b.co'])
  })

  it('409s before claiming when the admin has no verified mobile', async () => {
    cm.certNeedsMobileCheck.mockReturnValue(true)
    cm.downloadableCert.mockResolvedValue({ tenant_id: 't-1', store_name: 'Acme' })
    cm.inCertStore.mockResolvedValue(false)
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ needsMobile: true })
    expect(query).not.toHaveBeenCalled()
  })

  it('goes on to claim once the mobile is verified', async () => {
    cm.certNeedsMobileCheck.mockReturnValue(true)
    cm.downloadableCert.mockResolvedValue({ tenant_id: 't-1', store_name: 'Acme' })
    cm.inCertStore.mockResolvedValue(true)
    expect((await call()).status).toBe(200)
  })

  describe('when the claim matches nothing', () => {
    beforeEach(() => query.mockResolvedValueOnce({ rows: [] }))

    it('404s for a certificate that is not this account\'s', async () => {
      query.mockResolvedValueOnce({ rows: [] })
      expect((await call()).status).toBe(404)
    })

    it('410s when revoked', async () => {
      query.mockResolvedValueOnce({ rows: [{ revoked_at: past, expires_at: future }] })
      const res = await call()
      expect(res.status).toBe(410)
      expect((await res.json()).error).toContain('revoked')
    })

    it('410s when expired', async () => {
      query.mockResolvedValueOnce({ rows: [{ revoked_at: null, expires_at: past }] })
      expect((await (await call()).json()).error).toContain('expired')
    })

    it('410s when already downloaded', async () => {
      query.mockResolvedValueOnce({ rows: [{ downloaded_at: past, revoked_at: null, expires_at: future }] })
      const res = await call()
      expect(res.status).toBe(410)
      expect((await res.json()).error).toContain('already been downloaded')
    })
  })

  it('500s when the blob cannot be decrypted', async () => {
    crypt.decryptPortalSecret.mockImplementation(() => {
      throw new Error('bad key')
    })
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('could not be decrypted')
  })
})
