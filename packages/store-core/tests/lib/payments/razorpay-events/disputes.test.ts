import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/payments/refund', () => ({ recordExternalRefund: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/payments/webhook-tenant', () => ({
  isFlagship: vi.fn(() => false),
  runInTenant: vi.fn((_t: unknown, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('@/lib/google-ads/conversions/queue', () => ({ queueAdsConversion: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/payments/dispute-records', () => ({
  followUpDispute: vi.fn(() => Promise.resolve()),
  isNewDisputeAlert: vi.fn(() => true),
  upsertDispute: vi.fn(),
}))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/payments/razorpay-events/context', () => ({ storeFor: vi.fn() }))
vi.mock('@/lib/orders/entitlements', () => ({ revokeOrderEntitlements: vi.fn(() => Promise.resolve()) }))

import { onDispute } from '@/lib/payments/razorpay-events/disputes'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { recordExternalRefund } from '@/lib/payments/refund'
import { isFlagship } from '@/lib/payments/webhook-tenant'
import { queueAdsConversion } from '@/lib/google-ads/conversions/queue'
import { followUpDispute, isNewDisputeAlert, upsertDispute } from '@/lib/payments/dispute-records'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { storeFor } from '@/lib/payments/razorpay-events/context'

const store = { tenantId: 't1', slug: 'acme', ctx: null }
const ctx = (over: Record<string, unknown> = {}) => ({ source: 'platform', store: null, eventId: 'e', accountId: null, ...over }) as any
const row = { id: 1, amount: '50', razorpay_payment_id: 'pay_1', razorpay_dispute_id: 'disp_1' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(storeFor).mockResolvedValue(store as any)
  vi.mocked(isFlagship).mockReturnValue(false)
  vi.mocked(upsertDispute).mockResolvedValue(row as any)
  vi.mocked(isNewDisputeAlert).mockReturnValue(true)
  vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) }))
})

describe('onDispute', () => {
  it('returns when dispute id or payment id missing', async () => {
    await onDispute('payment.dispute.created', {}, {}, ctx())
    expect(storeFor).not.toHaveBeenCalled()
    await onDispute('payment.dispute.created', { id: 'd' }, {}, ctx())
    expect(storeFor).not.toHaveBeenCalled()
  })

  it('drops when no store', async () => {
    vi.mocked(storeFor).mockResolvedValue(null)
    await onDispute('payment.dispute.created', { id: 'd', payment_id: 'pay_1' }, null, ctx())
    expect(upsertDispute).not.toHaveBeenCalled()
  })

  it('upserts the dispute and follows up', async () => {
    await onDispute('payment.dispute.created', { id: 'd', payment_id: 'pay_1' }, { id: 'pay_1' }, ctx())
    expect(upsertDispute).toHaveBeenCalledWith(expect.objectContaining({ id: 'd', payment_id: 'pay_1' }), 'payment.dispute.created')
    expect(followUpDispute).toHaveBeenCalledWith(row, 'payment.dispute.created')
  })

  it('does not follow up when upsert returns nothing', async () => {
    vi.mocked(upsertDispute).mockResolvedValue(null as any)
    await onDispute('payment.dispute.created', { id: 'd', payment_id: 'pay_1' }, null, ctx())
    expect(followUpDispute).not.toHaveBeenCalled()
    expect(createAdminNotification).not.toHaveBeenCalled()
  })

  it('alerts the flagship for a new Route-store dispute on the platform account', async () => {
    await onDispute('payment.dispute.created', { id: 'd', payment_id: 'pay_1' }, null, ctx({ source: 'platform' }))
    expect(createAdminNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'payment_dispute', severity: 'critical' }))
  })

  it('does not alert on own account', async () => {
    await onDispute('payment.dispute.created', { id: 'd', payment_id: 'pay_1' }, null, ctx({ source: 'own', store }))
    expect(createAdminNotification).not.toHaveBeenCalled()
  })

  it('does not alert for a flagship store', async () => {
    vi.mocked(isFlagship).mockReturnValue(true)
    await onDispute('payment.dispute.created', { id: 'd', payment_id: 'pay_1' }, null, ctx())
    expect(createAdminNotification).not.toHaveBeenCalled()
  })

  it('does not alert when isNewDisputeAlert is false', async () => {
    vi.mocked(isNewDisputeAlert).mockReturnValue(false)
    await onDispute('payment.dispute.created', { id: 'd', payment_id: 'pay_1' }, null, ctx())
    expect(createAdminNotification).not.toHaveBeenCalled()
  })

  describe('payment.dispute.lost', () => {
    it('records an external refund (full) and revokes entitlements + queues ads', async () => {
      const { revokeOrderEntitlements } = await import('@/lib/orders/entitlements')
      vi.mocked(queryOne).mockResolvedValue({ order_id: 'ord', amount: '100.00', order_number: 'N1', total_amount: '100.00' } as any)
      await onDispute('payment.dispute.lost', { id: 'd', payment_id: 'pay_1', amount: 10000, amount_deducted: 10000 }, { id: 'pay_1' }, ctx())
      expect(recordExternalRefund).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ord', full: true, purpose: 'dispute', tenantId: 't1' }))
      expect(revokeOrderEntitlements).toHaveBeenCalled()
      expect(queueAdsConversion).toHaveBeenCalledWith('ord')
    })

    it('records a partial dispute refund without revoking the order', async () => {
      vi.mocked(queryOne).mockResolvedValue({ order_id: 'ord', amount: '100.00', order_number: 'N1', total_amount: '100.00' } as any)
      await onDispute('payment.dispute.lost', { id: 'd', payment_id: 'pay_1', amount: 1000 }, { id: 'pay_1' }, ctx())
      expect(recordExternalRefund).toHaveBeenCalledWith(expect.objectContaining({ full: false }))
      expect(withTransaction).not.toHaveBeenCalled()
    })

    it('does nothing when the lost dispute has no deductible amount', async () => {
      await onDispute('payment.dispute.lost', { id: 'd', payment_id: 'pay_1', amount: 0 }, { id: 'pay_1' }, ctx())
      expect(recordExternalRefund).not.toHaveBeenCalled()
    })

    it('does nothing when no completed un-disputed payment row matches', async () => {
      vi.mocked(queryOne).mockResolvedValue(null)
      await onDispute('payment.dispute.lost', { id: 'd', payment_id: 'pay_1', amount: 10000 }, { id: 'pay_1' }, ctx())
      expect(recordExternalRefund).not.toHaveBeenCalled()
    })

    it('uses undefined tenantId for a flagship store', async () => {
      vi.mocked(isFlagship).mockReturnValue(true)
      vi.mocked(queryOne).mockResolvedValue({ order_id: 'ord', amount: '100.00', order_number: 'N1', total_amount: '100.00' } as any)
      await onDispute('payment.dispute.lost', { id: 'd', payment_id: 'pay_1', amount: 10000 }, { id: 'pay_1' }, ctx())
      expect(recordExternalRefund).toHaveBeenCalledWith(expect.objectContaining({ tenantId: undefined }))
    })

    it('swallows an error in the lost-dispute handler', async () => {
      vi.mocked(queryOne).mockRejectedValue(new Error('db down'))
      await expect(onDispute('payment.dispute.lost', { id: 'd', payment_id: 'pay_1', amount: 10000 }, { id: 'pay_1' }, ctx())).resolves.toBeUndefined()
    })
  })
})
