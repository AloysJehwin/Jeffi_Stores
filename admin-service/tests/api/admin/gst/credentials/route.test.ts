import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({
  getIntegrationCredential: vi.fn(),
  saveIntegrationCredential: vi.fn(),
  deleteIntegrationCredential: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({ encryptToken: vi.fn((s: string) => `enc(${s})`) }))
vi.mock('@/lib/shipping/gst-api-creds', () => ({
  GST_API_PROVIDERS: ['ewaybill', 'einvoice'],
  GST_API_LABEL: { ewaybill: 'e-way bill', einvoice: 'e-invoice' },
  GST_API_DEFAULT_BASE: { ewaybill: 'https://nic/ewb', einvoice: 'https://nic/inv' },
  envGstApiCreds: vi.fn(),
  gstApiStore: vi.fn(),
  storeGstin: vi.fn(),
  validGstBaseUrl: vi.fn((v: string) => v.startsWith('https://')),
}))

import { GET, POST, DELETE } from '@admin/app/api/(admin)/admin/gst/credentials/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { getIntegrationCredential, saveIntegrationCredential, deleteIntegrationCredential } from '@/lib/tenant-registry'
import { envGstApiCreds, gstApiStore, storeGstin } from '@/lib/shipping/gst-api-creds'

const req = (method: string, body?: unknown) => new NextRequest('http://localhost/api/admin/gst/credentials', { method, body: body === undefined ? undefined : JSON.stringify(body) })
const good = { provider: 'ewaybill', username: 'u', password: 'p', clientId: 'c', clientSecret: 's', baseUrl: 'https://gsp.example/api/' }

describe('gst/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(gstApiStore).mockResolvedValue('t1' as any)
    vi.mocked(storeGstin).mockResolvedValue('29ABCDE1234F1Z5')
  })

  it('relays scope rejections with gst:read / gst:write', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req('GET'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'gst:read')
    expect((await POST(req('POST', good))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'gst:write')
    expect((await DELETE(req('DELETE', { provider: 'ewaybill' }))).status).toBe(403)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  describe('GET', () => {
    it('never returns secrets for a tenant store', async () => {
      vi.mocked(getIntegrationCredential).mockImplementation((async (_t: string, p: string) =>
        p === 'ewaybill' ? { status: 'connected', meta: { username: 'u', base_url: 'https://gsp/x', password: 'secret' } } : null) as any)
      const j = await (await GET(req('GET'))).json()
      expect(j.flagship).toBe(false)
      expect(j.gstin).toBe('29ABCDE1234F1Z5')
      expect(j.providers).toEqual([
        { provider: 'ewaybill', connected: true, username: 'u', baseUrl: 'https://gsp/x' },
        { provider: 'einvoice', connected: false, username: null, baseUrl: null },
      ])
      expect(JSON.stringify(j)).not.toContain('secret')
    })

    it('reads the platform env on the flagship', async () => {
      vi.mocked(gstApiStore).mockResolvedValue(null as any)
      vi.mocked(envGstApiCreds).mockImplementation(((p: string) => (p === 'einvoice' ? { username: 'env', baseUrl: 'https://env' } : null)) as any)
      const j = await (await GET(req('GET'))).json()
      expect(j.flagship).toBe(true)
      expect(j.providers[1]).toEqual({ provider: 'einvoice', connected: true, username: 'env', baseUrl: 'https://env' })
      expect(getIntegrationCredential).not.toHaveBeenCalled()
    })

    it('treats a failing lookup as not connected', async () => {
      vi.mocked(getIntegrationCredential).mockRejectedValue(new Error('db'))
      const j = await (await GET(req('GET'))).json()
      expect(j.providers.every((p: any) => !p.connected)).toBe(true)
    })
  })

  describe('POST', () => {
    it('400s on invalid input', async () => {
      expect((await POST(req('POST', { ...good, username: '' }))).status).toBe(400)
      expect((await POST(req('POST', { ...good, provider: 'x' }))).status).toBe(400)
      expect((await POST(req('POST', { ...good, baseUrl: 'http://insecure' }))).status).toBe(400)
      expect((await POST(req('POST', null))).status).toBe(400)
      expect(saveIntegrationCredential).not.toHaveBeenCalled()
    })

    it('400s on the flagship', async () => {
      vi.mocked(gstApiStore).mockResolvedValue(null as any)
      expect((await POST(req('POST', good))).status).toBe(400)
      expect(saveIntegrationCredential).not.toHaveBeenCalled()
    })

    it('saves the encrypted config, keeps secrets out of meta, and audits', async () => {
      const res = await POST(req('POST', good))
      expect(await res.json()).toEqual({ ok: true })
      const arg = vi.mocked(saveIntegrationCredential).mock.calls[0][0] as any
      expect(arg).toMatchObject({ tenantId: 't1', provider: 'ewaybill', label: 'E-way bill API' })
      expect(arg.meta).toEqual({ username: 'u', base_url: 'https://gsp.example/api', connected_via: 'manual' })
      expect(JSON.parse(arg.configEnc.slice(4, -1))).toEqual({ username: 'u', password: 'p', client_id: 'c', client_secret: 's', base_url: 'https://gsp.example/api' })
      expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', summary: expect.stringContaining('e-way bill') }))
    })
  })

  describe('DELETE', () => {
    it('400s on an unknown provider and on the flagship', async () => {
      expect((await DELETE(req('DELETE', { provider: 'x' }))).status).toBe(400)
      vi.mocked(gstApiStore).mockResolvedValue(null as any)
      expect((await DELETE(req('DELETE', { provider: 'einvoice' }))).status).toBe(400)
      expect(deleteIntegrationCredential).not.toHaveBeenCalled()
    })

    it('removes the credentials and audits', async () => {
      expect(await (await DELETE(req('DELETE', { provider: 'einvoice' }))).json()).toEqual({ ok: true })
      expect(deleteIntegrationCredential).toHaveBeenCalledWith('t1', 'einvoice')
      expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.stringContaining('Removed') }))
    })
  })
})
