import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const txQuery = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: any) => fn({ query: txQuery })),
}))
vi.mock('@/lib/orders/entitlements', () => ({ revokeOrderEntitlements: vi.fn().mockResolvedValue(1) }))
vi.mock('@/lib/payments/razorpay-route', () => ({
  transferToLinkedAccount: vi.fn(),
  recordTenantTransaction: vi.fn(),
  recordRefundSettlement: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn().mockRejectedValue(new Error('no keys')) }))
vi.mock('@/lib/tenant-registry/host-resolution', () => ({
  lookupTenantContextById: vi.fn().mockResolvedValue({ tenantId: 't-1', slug: 'acme' }),
}))
vi.mock('@/lib/tenancy/tenant-context', () => ({
  getCurrentTenant: vi.fn().mockReturnValue(null),
  runWithTenantContext: vi.fn(async (_ctx: any, fn: any) => fn()),
}))
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}))
vi.mock('@/lib/email', () => ({}))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn().mockResolvedValue({}) }))

import { POST } from '@/app/api/(public)/webhooks/razorpay/route'
import * as db from '@/lib/shared/db'
import { revokeOrderEntitlements } from '@/lib/orders/entitlements'
import { recordRefundSettlement } from '@/lib/payments/razorpay-route'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'

const SECRET = 'whsec'
function refundEvent(refund: any) {
  const body = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: refund } } })
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
  return new Request('http://localhost/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig },
    body,
  }) as any
}

describe('Razorpay refund webhook — vault revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET
    vi.mocked(db.query).mockResolvedValue({ rows: [{ order_id: 'ord-1' }], rowCount: 1 } as any)
    txQuery.mockResolvedValue({ rows: [{ order_number: 'JS-1', total_amount: '500.00' }] })
  })

  it('revokes all digital lines inside the tenant on a full refund', async () => {
    const res = await POST(refundEvent({ payment_id: 'pay_1', amount: 50000, notes: { tenant_id: 't-1' } }))
    expect(res.status).toBe(200)
    expect(runWithTenantContext).toHaveBeenCalled()
    expect(revokeOrderEntitlements).toHaveBeenCalledWith(expect.anything(), { orderId: 'ord-1', reason: 'refund' })
    expect(recordRefundSettlement).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-1', orderRef: 'JS-1' }))
  })

  it('does not revoke on a partial refund', async () => {
    await POST(refundEvent({ payment_id: 'pay_1', amount: 10000, notes: { tenant_id: 't-1' } }))
    expect(revokeOrderEntitlements).not.toHaveBeenCalled()
    expect(recordRefundSettlement).toHaveBeenCalled()
  })

  it('is a no-op when the app already recorded the refund', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    await POST(refundEvent({ payment_id: 'pay_1', amount: 50000, notes: { tenant_id: 't-1' } }))
    expect(revokeOrderEntitlements).not.toHaveBeenCalled()
    expect(recordRefundSettlement).not.toHaveBeenCalled()
  })

  it('still returns 200 when the revoke throws', async () => {
    vi.mocked(revokeOrderEntitlements).mockRejectedValueOnce(new Error('db down'))
    vi.mocked(db.queryOne).mockResolvedValueOnce({ order_number: 'JS-1' } as any)
    const res = await POST(refundEvent({ payment_id: 'pay_1', amount: 50000, notes: { tenant_id: 't-1' } }))
    expect(res.status).toBe(200)
    expect(recordRefundSettlement).toHaveBeenCalled()
  })
})
