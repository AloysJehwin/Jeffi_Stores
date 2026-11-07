// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/tenant-registry', () => ({
  resolveTenantFromHost: vi.fn(),
  slugFromHost: (host: string) => (host.startsWith('localhost') ? { slug: null, isCustomDomain: false } : { slug: host.split('.')[0], isCustomDomain: false }),
}))
vi.mock('@/lib/integrations/resolve', () => ({ resolveMarketplaceCreds: vi.fn() }))
vi.mock('@/lib/marketplace/ingest', () => ({ recordEvents: vi.fn(), processEvents: vi.fn() }))

import { POST as myntra } from '@storefront/app/api/(public)/webhooks/myntra/route'
import { POST as ajio } from '@storefront/app/api/(public)/webhooks/ajio/route'
import { resolveTenantFromHost } from '@/lib/tenant-registry'
import { resolveMarketplaceCreds } from '@/lib/integrations/resolve'
import { recordEvents, processEvents } from '@/lib/marketplace/ingest'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'

const store = { tenantId: 't-acme', slug: 'acme', displayName: 'Acme', plan: 'growth', infra: null }
const body = { orders: [{ eventId: 'ev-1', orderId: 'MO-1', status: 'CREATED', lines: [{ lineId: 'L1', sku: 'TEE-RED-M', price: 499 }] }] }

function push(token: string | null, host = 'acme.jeffistores.in', raw = JSON.stringify(body)) {
  const headers: Record<string, string> = { host, 'content-type': 'application/json' }
  if (token) headers['x-push-token'] = token
  return new Request(`https://${host}/api/webhooks/myntra`, { method: 'POST', headers, body: raw }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveTenantFromHost).mockResolvedValue(store as any)
  vi.mocked(resolveMarketplaceCreds).mockResolvedValue({ mode: 'mock', fields: {}, push_token: 'tok-current' })
  vi.mocked(recordEvents).mockResolvedValue({ ids: ['e1'], duplicates: 0 })
  vi.mocked(processEvents).mockResolvedValue({ processed: 1, pending: 0 })
})

describe('POST /api/webhooks/{myntra,ajio}', () => {
  it('stores the events for the store on the Host and processes them inline', async () => {
    let seen: string | undefined
    vi.mocked(recordEvents).mockImplementation(async () => {
      seen = getCurrentTenant()?.tenantId
      return { ids: ['e1'], duplicates: 0 }
    })
    const res = await myntra(push('tok-current'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, received: 1, duplicates: 0 })
    expect(resolveMarketplaceCreds).toHaveBeenCalledWith('myntra', 't-acme')
    expect(vi.mocked(recordEvents).mock.calls[0][0]).toBe('myntra')
    expect(vi.mocked(recordEvents).mock.calls[0][1][0]).toMatchObject({ key: 'ev-1', externalOrderId: 'MO-1' })
    expect(processEvents).toHaveBeenCalledWith(['e1'], 5000)
    expect(seen).toBe('t-acme')
  })

  it('404s an unknown store', async () => {
    vi.mocked(resolveTenantFromHost).mockResolvedValue(null)
    const res = await myntra(push('tok-current', 'ghost.jeffistores.in'))
    expect(res.status).toBe(404)
    expect(recordEvents).not.toHaveBeenCalled()
  })

  it('404s a store that has not connected the marketplace', async () => {
    vi.mocked(resolveMarketplaceCreds).mockResolvedValue(null)
    expect((await ajio(push('tok-current'))).status).toBe(404)
  })

  it('401s a wrong or missing token', async () => {
    expect((await myntra(push('tok-wrong'))).status).toBe(401)
    expect((await myntra(push(null))).status).toBe(401)
    expect(recordEvents).not.toHaveBeenCalled()
  })

  it('accepts the previous token for 24 hours after a rotate, then 401s it', async () => {
    const creds = (hoursAgo: number) => ({
      mode: 'mock' as const,
      fields: {},
      push_token: 'tok-new',
      push_token_prev: 'tok-old',
      push_token_rotated_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
    })
    vi.mocked(resolveMarketplaceCreds).mockResolvedValueOnce(creds(2))
    expect((await myntra(push('tok-old'))).status).toBe(200)
    vi.mocked(resolveMarketplaceCreds).mockResolvedValueOnce(creds(25))
    expect((await myntra(push('tok-old'))).status).toBe(401)
  })

  it('503s when the events cannot be recorded, so the marketplace retries', async () => {
    vi.mocked(recordEvents).mockRejectedValue(new Error('db down'))
    const res = await myntra(push('tok-current'))
    expect(res.status).toBe(503)
    expect(processEvents).not.toHaveBeenCalled()
  })

  it('answers 200 for a duplicate push without reprocessing it', async () => {
    vi.mocked(recordEvents).mockResolvedValue({ ids: [], duplicates: 1 })
    const res = await myntra(push('tok-current'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, duplicates: 1 })
    expect(processEvents).toHaveBeenCalledWith([], 5000)
  })

  it('still answers 200 once stored when inline processing throws', async () => {
    vi.mocked(processEvents).mockRejectedValue(new Error('boom'))
    expect((await myntra(push('tok-current'))).status).toBe(200)
  })

  it('rejects bodies over 1 MB and IPs outside the allowlist', async () => {
    expect((await myntra(push('tok-current', 'acme.jeffistores.in', 'x'.repeat(1024 * 1024 + 1)))).status).toBe(413)
    vi.mocked(resolveMarketplaceCreds).mockResolvedValue({ mode: 'mock', fields: {}, push_token: 'tok-current', ip_allowlist: ['203.0.113.0/24'] })
    const req = push('tok-current')
    req.headers.set('x-forwarded-for', '198.51.100.7')
    expect((await myntra(req)).status).toBe(403)
    const ok = push('tok-current')
    ok.headers.set('x-forwarded-for', '203.0.113.9, 10.0.0.1')
    expect((await myntra(ok)).status).toBe(200)
  })
})
