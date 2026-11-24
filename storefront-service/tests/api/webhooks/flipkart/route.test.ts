// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

vi.mock('@/lib/tenant-registry', () => ({
  resolveTenantFromHost: vi.fn(),
  slugFromHost: (host: string) => ({ slug: host.split('.')[0], isCustomDomain: false }),
}))
vi.mock('@/lib/integrations/resolve', () => ({ resolveMarketplaceCreds: vi.fn() }))
vi.mock('@/lib/marketplace/ingest', () => ({ recordEvents: vi.fn(), processEvents: vi.fn() }))

import { POST } from '@storefront/app/api/(public)/webhooks/flipkart/route'
import { resolveTenantFromHost } from '@/lib/tenant-registry'
import { resolveMarketplaceCreds } from '@/lib/integrations/resolve'
import { recordEvents, processEvents } from '@/lib/marketplace/ingest'

const APP_ID = 'test-app-id'
const APP_SECRET = 'test-app-secret'
const HOST = 'acme.jeffistores.in'
const URL_ = `https://${HOST}/api/webhooks/flipkart`
const store = { tenantId: 't-acme', slug: 'acme', displayName: 'Acme', plan: 'growth', infra: null }
const body = [{ eventType: 'order_item_approved', eventId: 'ev-1', orderId: 'OD1', shipmentId: 'S1', orderItems: [{ orderItemId: 'OI1', status: 'APPROVED', quantity: 1 }] }]

// Flipkart's scheme: X-Authorization "FKLOGIN " + base64(appId:sha1(date + url + method + secret)).
function signed(opts: { secret?: string; date?: string; raw?: string } = {}) {
  const date = opts.date ?? new Date().toUTCString()
  const sig = createHash('sha1').update(`${date}${URL_}POST${opts.secret ?? APP_SECRET}`).digest('hex')
  return new Request(URL_, {
    method: 'POST',
    headers: {
      host: HOST,
      'content-type': 'application/json',
      'x-date': date,
      'x-authorization': `FKLOGIN ${Buffer.from(`${APP_ID}:${sig}`).toString('base64')}`,
    },
    body: opts.raw ?? JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  vi.mocked(resolveTenantFromHost).mockResolvedValue(store as any)
  vi.mocked(resolveMarketplaceCreds).mockResolvedValue({ mode: 'sandbox', fields: { app_id: APP_ID, app_secret: APP_SECRET } } as any)
  vi.mocked(recordEvents).mockResolvedValue({ ids: ['e1'], duplicates: 0 })
  vi.mocked(processEvents).mockResolvedValue({ processed: 1, pending: 0 })
})

describe('POST /api/webhooks/flipkart', () => {
  it('accepts a correctly signed push, stores it for the store on the Host and processes it', async () => {
    const res = await POST(signed())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, duplicates: 0, processed: 1 })
    expect(resolveMarketplaceCreds).toHaveBeenCalledWith('flipkart', 't-acme')
    expect(vi.mocked(recordEvents).mock.calls[0][0]).toBe('flipkart')
    expect(processEvents).toHaveBeenCalledWith(['e1'], 5000)
  })

  it('401s a bad signature and stores nothing', async () => {
    const res = await POST(signed({ secret: 'wrong-secret' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid signature')
    expect(recordEvents).not.toHaveBeenCalled()
  })

  it('401s a missing signature header', async () => {
    const req = new Request(URL_, { method: 'POST', headers: { host: HOST }, body: JSON.stringify(body) }) as any
    expect((await POST(req)).status).toBe(401)
  })

  it('401s a stale signed date (replay window)', async () => {
    const old = new Date(Date.now() - 24 * 3600_000).toUTCString()
    expect((await POST(signed({ date: old }))).status).toBe(401)
    expect(recordEvents).not.toHaveBeenCalled()
  })

  it('is idempotent: a replayed push is acknowledged without reprocessing', async () => {
    vi.mocked(recordEvents).mockResolvedValue({ ids: [], duplicates: 1 })
    const res = await POST(signed())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, duplicates: 1 })
    expect(processEvents).toHaveBeenCalledWith([], 5000)
  })

  it('400s malformed JSON (after the signature passes)', async () => {
    expect((await POST(signed({ raw: '{nope' }))).status).toBe(400)
  })

  it('503s when events cannot be recorded so Flipkart retries', async () => {
    vi.mocked(recordEvents).mockRejectedValue(new Error('db'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(signed())).status).toBe(503)
  })
})
