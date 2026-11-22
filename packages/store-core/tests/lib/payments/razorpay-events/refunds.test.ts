import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/payments/route-settlement', () => ({ applyRouteRefund: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/payments/webhook-tenant', () => ({
  isFlagship: vi.fn(() => false),
  runInTenant: vi.fn((_t: unknown, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('@/lib/google-ads/conversions/queue', () => ({ queueAdsConversion: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/payments/refund-records', () => ({ applyRefundEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/payments/razorpay-events/context', () => ({ storeFor: vi.fn() }))
vi.mock('@/lib/orders/entitlements', () => ({ revokeOrderEntitlements: vi.fn(() => Promise.resolve()) }))

import { onRefund } from '@/lib/payments/razorpay-events/refunds'
import { queryOne, query, withTransaction } from '@/lib/shared/db'
import { applyRouteRefund } from '@/lib/payments/route-settlement'
import { isFlagship } from '@/lib/payments/webhook-tenant'
import { queueAdsConversion } from '@/lib/google-ads/conversions/queue'
import { applyRefundEvent } from '@/lib/payments/refund-records'
import { storeFor } from '@/lib/payments/razorpay-events/context'

const store = { tenantId: 't1', slug: 'acme', ctx: null }
const ctx = (over: Record<string, unknown> = {}) => ({ source: 'platform', store: null, eventId: 'e', accountId: null, ...over }) as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(storeFor).mockResolvedValue(store as any)
  vi.mocked(isFlagship).mockReturnValue(false)
  vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
    fn({ query: vi.fn(async () => ({ rows: [{ order_number: 'N1', total_amount: '100.00' }] })) })
  )
})

describe('onRefund', () => {
  it('returns early when the refund has no payment_id', async () => {
    await onRefund('refund.processed', {}, {}, ctx())
    expect(storeFor).not.toHaveBeenCalled()
  })

  it('drops when no store resolves', async () => {
    vi.mocked(storeFor).mockResolvedValue(null)
    await onRefund('refund.processed', { payment_id: 'pay_1' }, {}, ctx())
    expect(applyRefundEvent).not.toHaveBeenCalled()
  })

  it('always applies the refund event (status/ARN/speed)', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    await onRefund('refund.failed', { payment_id: 'pay_1', id: 'rf_1' }, {}, ctx())
    expect(applyRefundEvent).toHaveBeenCalledWith('refund.failed', { payment_id: 'pay_1', id: 'rf_1' }, store)
  })

  it('returns after applyRefundEvent for non created/processed types', async () => {
    await onRefund('refund.speed_changed', { payment_id: 'pay_1' }, {}, ctx())
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('swallows an applyRefundEvent failure (logs, continues)', async () => {
    vi.mocked(applyRefundEvent).mockRejectedValue(new Error('route undo'))
    vi.mocked(queryOne).mockResolvedValue(null)
    await expect(onRefund('refund.created', { payment_id: 'pay_1' }, {}, ctx())).resolves.toBeUndefined()
  })

  it('no-ops the ledger path when the payment is already recorded (no current row)', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null) // SELECT current
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf' }, {}, ctx())
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })

  it('books a PARTIAL dashboard refund against the payment only', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any) // current
      .mockResolvedValueOnce({ order_number: 'N1' } as any) // order_number lookup
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf_1', amount: 1000 }, { amount_refunded: 1000 }, ctx())
    expect(query).toHaveBeenCalledWith(expect.stringContaining('partial_refunds'), expect.any(Array))
    expect(applyRouteRefund).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay_1', refundId: 'rf_1', orderRef: 'N1' }))
  })

  it('marks the payment+order refunded on a FULL refund and queues ads conversion', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any) // current
    vi.mocked(query).mockResolvedValue({ rows: [{ order_id: 'ord' }] } as any) // UPDATE payments RETURNING
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf_1', amount: 10000 }, { refund_status: 'full', amount_refunded: 10000 }, ctx())
    expect(withTransaction).toHaveBeenCalled()
    expect(queueAdsConversion).toHaveBeenCalledWith('ord')
    expect(applyRouteRefund).toHaveBeenCalled()
  })

  it('does not book a Route refund for a flagship store', async () => {
    vi.mocked(isFlagship).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any)
    vi.mocked(query).mockResolvedValue({ rows: [{ order_id: 'ord' }] } as any)
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf', amount: 10000 }, { refund_status: 'full' }, ctx())
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })

  it('returns when the full-refund UPDATE finds no order id', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any)
    vi.mocked(query).mockResolvedValue({ rows: [] } as any) // no RETURNING row
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf', amount: 10000 }, { refund_status: 'full' }, ctx())
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })

  it('revokes entitlements when the refund covers the whole order total', async () => {
    const { revokeOrderEntitlements } = await import('@/lib/orders/entitlements')
    vi.mocked(queryOne).mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any)
    vi.mocked(query).mockResolvedValue({ rows: [{ order_id: 'ord' }] } as any)
    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn({ query: vi.fn(async () => ({ rows: [{ order_number: 'N1', total_amount: '100.00' }] })) })
    )
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf', amount: 10000 }, { refund_status: 'full' }, ctx())
    expect(revokeOrderEntitlements).toHaveBeenCalled()
  })

  it('falls back to a plain order update when the transaction throws', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any) // current
      .mockResolvedValueOnce({ order_number: 'N1' } as any) // fallback UPDATE RETURNING
    vi.mocked(query).mockResolvedValue({ rows: [{ order_id: 'ord' }] } as any)
    vi.mocked(withTransaction).mockRejectedValue(new Error('tx boom'))
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf', amount: 10000 }, { refund_status: 'full' }, ctx())
    expect(applyRouteRefund).toHaveBeenCalled()
  })

  it('swallows a rejection of the current-row SELECT (treated as already recorded)', async () => {
    vi.mocked(queryOne).mockRejectedValueOnce(new Error('db')) // SELECT current rejects
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf' }, {}, ctx())
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })

  it('swallows a rejection of the partial-refund booking query and order_number lookup', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any) // current
      .mockRejectedValueOnce(new Error('db')) // order_number lookup rejects → null
    vi.mocked(query).mockRejectedValue(new Error('db')) // partial booking rejects → caught
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf', amount: 1000 }, { amount_refunded: 1000 }, ctx())
    // order was null so no Route refund
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })

  it('swallows a rejection of the full-refund UPDATE query (no order id)', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any)
    vi.mocked(query).mockRejectedValue(new Error('db')) // UPDATE payments rejects → null
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf', amount: 10000 }, { refund_status: 'full' }, ctx())
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })

  it('swallows a rejection of the transaction-fallback queryOne', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any) // current
      .mockRejectedValueOnce(new Error('fallback db')) // fallback UPDATE rejects → null
    vi.mocked(query).mockResolvedValue({ rows: [{ order_id: 'ord' }] } as any)
    vi.mocked(withTransaction).mockRejectedValue(new Error('tx boom'))
    await onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf', amount: 10000 }, { refund_status: 'full' }, ctx())
    // order (row) null → no Route refund
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })

  it('swallows a rejection of applyRouteRefund', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ order_id: 'ord', amount: '100.00' } as any)
    vi.mocked(query).mockResolvedValue({ rows: [{ order_id: 'ord' }] } as any)
    vi.mocked(applyRouteRefund).mockRejectedValue(new Error('route down'))
    await expect(
      onRefund('refund.processed', { payment_id: 'pay_1', id: 'rf', amount: 10000 }, { refund_status: 'full' }, ctx())
    ).resolves.toBeUndefined()
    expect(applyRouteRefund).toHaveBeenCalled()
  })
})
