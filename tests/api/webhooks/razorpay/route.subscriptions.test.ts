import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn(),
  sendNewOrderNotification: vi.fn(),
  sendPaymentStatusUpdate: vi.fn(),
}))
vi.mock('@/lib/payments/webhook-tenant', () => ({
  resolveSubscriptionTenant: vi.fn(),
  runInTenant: vi.fn(async (_t: unknown, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('@/lib/subscriptions/cycle', () => ({ processSubscriptionEvent: vi.fn(async () => true) }))

import { POST } from '@/app/api/(public)/webhooks/razorpay/route'
import { resolveSubscriptionTenant, runInTenant } from '@/lib/payments/webhook-tenant'
import { processSubscriptionEvent } from '@/lib/subscriptions/cycle'

const SECRET = 'test-webhook-secret'
function req(body: object) {
  const raw = JSON.stringify(body)
  return new Request('http://localhost/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'x-razorpay-signature': crypto.createHmac('sha256', SECRET).update(raw).digest('hex') },
    body: raw,
  }) as any
}
const evt = { event: 'subscription.halted', payload: { subscription: { entity: { id: 'sub_1' } } } }

describe('platform webhook — subscription events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET
  })

  it('routes via the control-plane index and runs the engine in that tenant', async () => {
    const t = { tenantId: 't1', slug: 'acme', ctx: {} }
    vi.mocked(resolveSubscriptionTenant).mockResolvedValue(t as any)
    const res = await POST(req(evt))
    expect(res.status).toBe(200)
    expect(runInTenant).toHaveBeenCalledWith(t, expect.any(Function))
    expect(processSubscriptionEvent).toHaveBeenCalledWith('subscription.halted', evt, { tenantId: 't1', slug: 'acme' })
  })

  it('acks and drops an unindexed subscription', async () => {
    vi.mocked(resolveSubscriptionTenant).mockResolvedValue(null)
    const res = await POST(req(evt))
    expect(res.status).toBe(200)
    expect(processSubscriptionEvent).not.toHaveBeenCalled()
  })

  it('503s when the in-tenant engine fails so Razorpay retries', async () => {
    vi.mocked(resolveSubscriptionTenant).mockResolvedValue({ tenantId: 't1', slug: 'acme', ctx: null } as any)
    vi.mocked(processSubscriptionEvent).mockRejectedValue(new Error('db down'))
    expect((await POST(req(evt))).status).toBe(503)
  })

  it('503s when the control-plane lookup fails', async () => {
    vi.mocked(resolveSubscriptionTenant).mockRejectedValue(new Error('cp down'))
    expect((await POST(req(evt))).status).toBe(503)
  })
})
