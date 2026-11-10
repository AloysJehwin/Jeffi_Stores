import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(async () => null) }))
vi.mock('@/lib/payments/webhook-tenant', () => ({
  flagshipScope: () => ({ tenantId: '00000000-0000-0000-0000-000000000000', slug: 'platform', ctx: null }),
  scopeForTenantId: vi.fn(async (id: string) => ({ tenantId: id, slug: 'acme', ctx: null })),
  runInTenant: (_t: unknown, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/payments/upi/creds', () => ({ platformPhonePeCreds: vi.fn(), storedPhonePeCreds: vi.fn() }))
vi.mock('@/lib/payments/upi/settle', () => ({ settleUpiIntent: vi.fn(), applyPhonePeRefundState: vi.fn() }))
vi.mock('@/lib/payments/upi/autopay-webhook', () => ({ handleAutopayWebhook: vi.fn(async () => ({ handled: false })), isAutopayEvent: (t: string) => t.startsWith('subscription.') }))

import { handlePhonePeCallback } from '@/lib/payments/upi/webhook'
import { platformPhonePeCreds, storedPhonePeCreds } from '@/lib/payments/upi/creds'
import { settleUpiIntent } from '@/lib/payments/upi/settle'
import { scopeForTenantId } from '@/lib/payments/webhook-tenant'

const hash = (u: string, p: string) => crypto.createHash('sha256').update(`${u}:${p}`).digest('hex')
const T = '11111111-1111-4111-8111-111111111111'
const body = (udf1?: string) => JSON.stringify({ event: 'checkout.order.completed', payload: { merchantOrderId: 'JSabc', state: 'COMPLETED', metaInfo: { udf1 } } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(platformPhonePeCreds).mockReturnValue({ webhookUsername: 'u', webhookPassword: 'p' } as any)
  vi.mocked(storedPhonePeCreds).mockResolvedValue({ webhookUsername: 'tu', webhookPassword: 'tp' } as any)
  vi.mocked(settleUpiIntent).mockResolvedValue({ id: 'i1', status: 'completed' } as any)
})

describe('handlePhonePeCallback', () => {
  it('rejects a wrong or missing Authorization', async () => {
    expect((await handlePhonePeCallback({ rawBody: body('cp'), authHeader: hash('u', 'wrong'), scope: 'platform' })).status).toBe(400)
    expect((await handlePhonePeCallback({ rawBody: body('cp'), authHeader: null, scope: 'platform' })).status).toBe(400)
    // a store's webhook never accepts the platform's credentials
    expect((await handlePhonePeCallback({ rawBody: body(T), authHeader: hash('u', 'p'), scope: { tenantId: T } })).status).toBe(400)
    expect(settleUpiIntent).not.toHaveBeenCalled()
  })

  it('settles from the status API in the store udf1 names', async () => {
    const r = await handlePhonePeCallback({ rawBody: body(T), authHeader: hash('u', 'p'), scope: 'platform' })
    expect(r).toEqual({ status: 200, body: { status: 'completed', intentId: 'i1' } })
    expect(scopeForTenantId).toHaveBeenCalledWith(T)
    expect(settleUpiIntent).toHaveBeenCalledWith('JSabc', { store: { tenantId: T, slug: 'acme' } })
  })

  it('answers 503 on a transient failure and 200 for events it ignores', async () => {
    vi.mocked(settleUpiIntent).mockRejectedValueOnce(new Error('phonepe down'))
    expect((await handlePhonePeCallback({ rawBody: body('cp'), authHeader: hash('u', 'p'), scope: 'platform' })).status).toBe(503)
    const other = JSON.stringify({ event: 'subscription.something', payload: {} })
    expect((await handlePhonePeCallback({ rawBody: other, authHeader: hash('u', 'p'), scope: 'platform' })).status).toBe(200)
    // another store's order arriving on a store's own webhook is dropped
    const r = await handlePhonePeCallback({ rawBody: body('22222222-2222-4222-8222-222222222222'), authHeader: hash('tu', 'tp'), scope: { tenantId: T } })
    expect(r.body.status).toBe('ignored')
  })
})
