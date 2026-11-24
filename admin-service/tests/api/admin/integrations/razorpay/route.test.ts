import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn(), requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(), isPlatformOwner: vi.fn() }))
vi.mock('@/lib/crypto/token-cipher', () => ({ encryptToken: vi.fn((s: string) => `enc(${s})`) }))
vi.mock('@/lib/tenant-registry', () => ({ getIntegrationCredential: vi.fn(), saveIntegrationCredential: vi.fn() }))
vi.mock('@/lib/tenant-registry/shared', () => ({ ROOT_DOMAIN: 'jeffi.test' }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveRazorpayCreds: vi.fn(), storedRazorpayKeys: vi.fn() }))
vi.mock('@/lib/integrations/test-connection', () => ({ testRazorpay: vi.fn(), verifyRazorpayKeys: vi.fn() }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/payments/rzp-webhook-health', () => ({ lastRazorpayWebhook: vi.fn() }))
vi.mock('@/lib/payments/razorpay-events/dispatch', () => ({
  RAZORPAY_WEBHOOK_EVENTS: [{ event: 'payment.captured' }, { event: 'platform.only', platformOnly: true }],
}))

import { GET, POST } from '@admin/app/api/(admin)/admin/integrations/razorpay/route'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'
import { resolveRazorpayCreds, storedRazorpayKeys } from '@/lib/integrations/resolve'
import { testRazorpay, verifyRazorpayKeys } from '@/lib/integrations/test-connection'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { lastRazorpayWebhook } from '@/lib/payments/rzp-webhook-health'

const get = () => new NextRequest('http://localhost/api/admin/integrations/razorpay')
const post = (body: unknown) => new NextRequest('http://localhost/api/admin/integrations/razorpay', { method: 'POST', body: JSON.stringify(body) })
const save = { action: 'save', key_id: 'rzp_live_ABCDEFGHIJKL1234', key_secret: 'shh' }

describe('integrations/razorpay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://hooks.test/')
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'owner', scopes: [], email: 'o@x.in' } as any)
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'owner', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'own', ownFlag: true, tenantId: 't1', slug: 'shop' } as any)
    vi.mocked(storedRazorpayKeys).mockResolvedValue(null as any)
    vi.mocked(lastRazorpayWebhook).mockResolvedValue('2026-11-01' as any)
    vi.mocked(verifyRazorpayKeys).mockResolvedValue({ ok: true, message: 'Verified' } as any)
  })

  it('GET relays a scope rejection', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(get())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
  })

  it('GET masks the key for a store that collects on its own account', async () => {
    vi.mocked(storedRazorpayKeys).mockResolvedValue({ key_id: 'rzp_live_ABCDEFGHIJKL1234', webhook_secret: 'w' } as any)
    const j = await (await GET(get())).json()
    expect(j).toMatchObject({ kind: 'own', editable: true, keyId: 'rzp_live_…1234', mode: 'live', webhookSecretSet: true, webhookUrl: 'https://hooks.test/api/webhooks/razorpay/shop', events: ['payment.captured'], lastWebhookAt: '2026-11-01' })
    expect(JSON.stringify(j)).not.toContain('ABCDEFGHIJKL')
  })

  it('GET on the flagship reads platform keys read-only with the platform-only events', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'platform', ownFlag: false, tenantId: null } as any)
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id: 'rzp_test_short' } as any)
    const j = await (await GET(get())).json()
    expect(j).toMatchObject({ editable: false, mode: 'test', keyId: 'rzp_test_…hort', webhookUrl: 'https://hooks.test/api/webhooks/razorpay', events: ['payment.captured', 'platform.only'] })
  })

  it('GET on a platform-routed store hides keys and webhook health', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route', ownFlag: false, tenantId: 't1' } as any)
    const j = await (await GET(get())).json()
    expect(j).toMatchObject({ keyId: null, mode: null, webhookUrl: null, lastWebhookAt: null })
  })

  it('POST 401s, 403s and 400s', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(post(save))).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(post(save))).status).toBe(403)
    vi.mocked(hasScope).mockReturnValue(true)
    expect((await POST(post({ action: 'nuke' }))).status).toBe(400)
    expect((await POST(post({ action: 'save', key_id: '', key_secret: '' }))).status).toBe(400)
  })

  it('POST test runs the connection check for the tenant', async () => {
    vi.mocked(testRazorpay).mockResolvedValue({ ok: true } as any)
    expect(await (await POST(post({ action: 'test' }))).json()).toEqual({ ok: true })
    expect(testRazorpay).toHaveBeenCalledWith('t1')
  })

  it('POST save 403s for a platform-collecting store and for non-owners', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route', ownFlag: false, tenantId: 't1' } as any)
    expect((await POST(post(save))).status).toBe(403)
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'own', ownFlag: true, tenantId: 't1' } as any)
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    expect((await POST(post(save))).status).toBe(403)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('POST save 400s when Razorpay rejects the keys', async () => {
    vi.mocked(verifyRazorpayKeys).mockResolvedValue({ ok: false, message: 'Invalid key' } as any)
    const res = await POST(post(save))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid key' })
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('POST save stores encrypted keys and keeps a previous webhook secret', async () => {
    vi.mocked(getIntegrationCredential).mockResolvedValue({ meta: { keep: 1 } } as any)
    vi.mocked(storedRazorpayKeys).mockResolvedValue({ webhook_secret: 'old-wh' } as any)
    const res = await POST(post(save))
    expect(await res.json()).toEqual({ ok: true, message: 'Verified', webhookSecretSet: true })
    const arg = vi.mocked(saveIntegrationCredential).mock.calls[0][0] as any
    expect(arg).toMatchObject({ tenantId: 't1', provider: 'razorpay' })
    expect(JSON.parse(arg.configEnc.slice(4, -1))).toEqual({ key_id: save.key_id, key_secret: 'shh', webhook_secret: 'old-wh' })
    expect(arg.meta).toMatchObject({ keep: 1, key_id: save.key_id, updated_by: 'o@x.in' })
    expect(JSON.stringify(arg.meta)).not.toContain('shh')
  })
})
