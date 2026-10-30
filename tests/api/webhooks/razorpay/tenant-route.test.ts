import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/tenant-registry', () => ({ lookupTenantContextBySlug: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveRazorpayCreds: vi.fn() }))
vi.mock('@/lib/subscriptions/cycle', async () => ({
  isSubscriptionEvent: (e: string) => e.startsWith('subscription.'),
  processSubscriptionEvent: vi.fn(async () => true),
}))

import { POST } from '@controller/app/api/(public)/webhooks/razorpay/[tenant]/route'
import { lookupTenantContextBySlug } from '@/lib/tenant-registry'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'
import { processSubscriptionEvent } from '@/lib/subscriptions/cycle'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'

const TENANT_SECRET = 'tenant-own-secret'
const ctx = { tenantId: 't1', slug: 'acme', displayName: 'Acme', plan: 'basic', infra: null }

function req(body: object, secret = TENANT_SECRET, sig?: string) {
  const raw = JSON.stringify(body)
  return new Request('http://localhost/api/webhooks/razorpay/acme', {
    method: 'POST',
    headers: { 'x-razorpay-signature': sig ?? crypto.createHmac('sha256', secret).update(raw).digest('hex') },
    body: raw,
  }) as any
}
const params = (tenant = 'acme') => ({ params: Promise.resolve({ tenant }) })
const evt = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1' } } } }

describe('POST /api/webhooks/razorpay/[tenant]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(lookupTenantContextBySlug).mockResolvedValue(ctx as any)
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id: 'k', key_secret: 's', webhook_secret: TENANT_SECRET, isOwn: true })
  })

  it('verifies against the tenant secret and runs the engine in the tenant context', async () => {
    let seen: unknown = null
    vi.mocked(processSubscriptionEvent).mockImplementation(async () => {
      seen = getCurrentTenant()?.tenantId
      return true
    })
    const res = await POST(req(evt), params())
    expect(res.status).toBe(200)
    expect(resolveRazorpayCreds).toHaveBeenCalledWith('t1')
    expect(processSubscriptionEvent).toHaveBeenCalledWith('subscription.charged', evt, { tenantId: 't1', slug: 'acme' })
    expect(seen).toBe('t1')
  })

  it('rejects a body signed with the platform secret', async () => {
    const res = await POST(req(evt, 'test-webhook-secret'), params())
    expect(res.status).toBe(400)
    expect(processSubscriptionEvent).not.toHaveBeenCalled()
  })

  it('refuses tenants without their own Razorpay keys (no platform-secret fallback)', async () => {
    vi.mocked(resolveRazorpayCreds).mockResolvedValue({ key_id: 'k', key_secret: 's', webhook_secret: 'test-webhook-secret', isOwn: false })
    const res = await POST(req(evt, 'test-webhook-secret'), params())
    expect(res.status).toBe(404)
    expect(processSubscriptionEvent).not.toHaveBeenCalled()
  })

  it('404s an unknown store slug', async () => {
    vi.mocked(lookupTenantContextBySlug).mockResolvedValue(null)
    const res = await POST(req(evt), params('nope'))
    expect(res.status).toBe(404)
  })

  it('400s a missing signature', async () => {
    const r = new Request('http://localhost/x', { method: 'POST', body: '{}' }) as any
    expect((await POST(r, params())).status).toBe(400)
  })

  it('acks Route events, which only the platform account handles', async () => {
    const res = await POST(req({ event: 'transfer.processed', payload: { transfer: { entity: { id: 'trf_1' } } } }), params())
    expect(res.status).toBe(200)
    expect(processSubscriptionEvent).not.toHaveBeenCalled()
  })

  it('503s (Razorpay retries) when the engine throws', async () => {
    vi.mocked(processSubscriptionEvent).mockRejectedValue(new Error('db down'))
    const res = await POST(req(evt), params())
    expect(res.status).toBe(503)
  })
})
