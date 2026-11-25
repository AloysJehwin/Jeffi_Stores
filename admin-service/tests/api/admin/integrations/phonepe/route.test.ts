import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn(), requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(), isPlatformOwner: vi.fn() }))
vi.mock('@/lib/crypto/token-cipher', () => ({ encryptToken: vi.fn((s: string) => `enc(${s})`) }))
vi.mock('@/lib/tenant-registry', () => ({ deleteIntegrationCredential: vi.fn(), getIntegrationCredential: vi.fn(), saveIntegrationCredential: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ storedPhonePeCreds: vi.fn() }))
vi.mock('@/lib/integrations/test-connection', () => ({ testPhonePe: vi.fn(), verifyPhonePeCreds: vi.fn() }))
vi.mock('@/lib/payments/phonepe-account', () => ({ phonePeAccountFor: vi.fn() }))
vi.mock('@/lib/payments/upi/settings', () => ({ phonePeAccountInfo: vi.fn() }))
vi.mock('@/lib/payments/upi/creds', () => ({ invalidateUpiModeCache: vi.fn() }))

import { GET, PUT, POST, DELETE } from '@admin/app/api/(admin)/admin/integrations/phonepe/route'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { deleteIntegrationCredential, getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'
import { storedPhonePeCreds } from '@/lib/integrations/resolve'
import { testPhonePe, verifyPhonePeCreds } from '@/lib/integrations/test-connection'
import { phonePeAccountFor } from '@/lib/payments/phonepe-account'
import { phonePeAccountInfo } from '@/lib/payments/upi/settings'
import { invalidateUpiModeCache } from '@/lib/payments/upi/creds'

const req = (method: string, body?: unknown, qs = '') => new NextRequest(`http://localhost/api/admin/integrations/phonepe${qs}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
const good = { env: 'production', client_id: 'cid', client_secret: 'sec', client_version: '1', merchant_id: 'M1' }

describe('integrations/phonepe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'owner', scopes: [], email: 'o@x.in' } as any)
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    vi.mocked(phonePeAccountFor).mockResolvedValue({ credTenantId: 'ct', tenantId: 't1' } as any)
    vi.mocked(verifyPhonePeCreds).mockResolvedValue({ ok: true, message: 'Verified' } as any)
    vi.mocked(storedPhonePeCreds).mockResolvedValue(null as any)
    vi.mocked(getIntegrationCredential).mockResolvedValue(null as any)
  })

  it('GET relays a scope rejection and returns the account info', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req('GET'))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
    vi.mocked(phonePeAccountInfo).mockResolvedValue({ connected: true } as any)
    expect(await (await GET(req('GET'))).json()).toEqual({ connected: true })
  })

  it('PUT, POST and DELETE 401 without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await PUT(req('PUT', good))).status).toBe(401)
    expect((await POST(req('POST', {}, '?action=test'))).status).toBe(401)
    expect((await DELETE(req('DELETE'))).status).toBe(401)
  })

  it('403s without financial:write, and for non-owners on PUT/DELETE', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await PUT(req('PUT', good))).status).toBe(403)
    expect((await POST(req('POST', {}, '?action=test'))).status).toBe(403)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    expect((await PUT(req('PUT', good))).status).toBe(403)
    expect((await DELETE(req('DELETE'))).status).toBe(403)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
    expect(deleteIntegrationCredential).not.toHaveBeenCalled()
  })

  it('PUT 400s on invalid input and on creds PhonePe rejects', async () => {
    expect((await PUT(req('PUT', { ...good, env: 'staging' }))).status).toBe(400)
    vi.mocked(verifyPhonePeCreds).mockResolvedValue({ ok: false, message: 'Bad creds' } as any)
    const res = await PUT(req('PUT', good))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Bad creds' })
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('PUT saves encrypted creds, keeps saved webhook fields, and busts the UPI cache', async () => {
    vi.mocked(storedPhonePeCreds).mockResolvedValue({ merchant_id: 'OLD', webhook_username: 'wu', webhook_password: 'wp' } as any)
    vi.mocked(getIntegrationCredential).mockResolvedValue({ meta: { keep: 1 } } as any)
    const res = await PUT(req('PUT', { ...good, merchant_id: undefined }))
    expect(await res.json()).toEqual({ ok: true, message: 'Verified', webhookAuthSet: true })
    const arg = vi.mocked(saveIntegrationCredential).mock.calls[0][0] as any
    expect(arg).toMatchObject({ tenantId: 'ct', provider: 'phonepe', label: 'PhonePe' })
    expect(JSON.parse(arg.configEnc.slice(4, -1))).toMatchObject({ client_secret: 'sec', merchant_id: 'OLD', webhook_username: 'wu', webhook_password: 'wp' })
    expect(arg.meta).toMatchObject({ keep: 1, env: 'production', webhook_auth_set: true, updated_by: 'o@x.in' })
    expect(JSON.stringify(arg.meta)).not.toContain('sec')
    expect(invalidateUpiModeCache).toHaveBeenCalled()
  })

  it('POST only supports ?action=test', async () => {
    expect((await POST(req('POST', {}))).status).toBe(400)
    vi.mocked(testPhonePe).mockResolvedValue({ ok: true } as any)
    expect(await (await POST(req('POST', {}, '?action=test'))).json()).toEqual({ ok: true })
    expect(testPhonePe).toHaveBeenCalledWith('t1')
  })

  it('DELETE removes the credentials and busts the cache', async () => {
    expect(await (await DELETE(req('DELETE'))).json()).toEqual({ ok: true })
    expect(deleteIntegrationCredential).toHaveBeenCalledWith('ct', 'phonepe')
    expect(invalidateUpiModeCache).toHaveBeenCalled()
  })
})
