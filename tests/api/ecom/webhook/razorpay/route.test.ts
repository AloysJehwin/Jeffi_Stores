import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  bySub: vi.fn(),
  subStatus: vi.fn(),
  addServices: vi.fn(),
  storeRequest: vi.fn(),
  trigger: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/payments/razorpay-subscriptions', () => ({ verifyWebhookSignature: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({
  getTenantBySubscriptionId: m.bySub,
  setSubscriptionStatus: m.subStatus,
  addTenantServices: m.addServices,
  setStoreRequest: m.storeRequest,
  controlPlanePool: () => ({ query: m.query }),
}))
vi.mock('@/lib/shared/ecom-emails', () => ({ sendStoreLiveEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/billing/platform-invoice', () => ({ issuePlatformInvoiceLater: vi.fn() }))
vi.mock('@/lib/provisioning/trigger', () => ({
  triggerProvisioning: m.trigger,
  resolveRestoreKey: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@controller/app/api/(ecom)/ecom/webhook/razorpay/route'

const charged = () =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/webhook/razorpay', {
    method: 'POST',
    body: JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1' } } } }),
  })

describe('subscription.charged on an approved store upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.trigger.mockResolvedValue({ ok: true })
    m.query.mockResolvedValue({ rows: [{ id: 'o-1', email: 'o@x', name: 'O', display_name: 'Acme', slug: 'acme', plan: 'basic' }] })
  })

  it('adds the store, keeps the tenant status and starts provisioning', async () => {
    m.bySub.mockResolvedValue({ id: 't-1', slug: 'acme', status: 'active', store_request: 'awaiting_payment' })
    const res = await POST(charged())
    expect(res.status).toBe(200)
    expect(m.addServices).toHaveBeenCalledWith('t-1', ['store'])
    expect(m.storeRequest).toHaveBeenCalledWith('t-1', 'provisioning')
    expect(m.subStatus).toHaveBeenCalledWith('t-1', 'active')
    expect(m.trigger).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-1', reason: 'first_payment' }))
  })

  it('treats a live services workspace with no application as a recurring charge', async () => {
    m.bySub.mockResolvedValue({ id: 't-1', slug: 'acme', status: 'active', store_request: null })
    await POST(charged())
    expect(m.addServices).not.toHaveBeenCalled()
    expect(m.trigger).not.toHaveBeenCalled()
  })
})
