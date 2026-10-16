import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn(async () => ({ rows: [] })) }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/payments/route-settlement', () => ({ applyRouteRefund: vi.fn(async () => ({ unrecoveredPaise: 0 })) }))
vi.mock('@/lib/google-ads/conversions/queue', () => ({ queueAdsConversion: vi.fn(async () => ({ action: 'none', reason: 'test' })) }))

import { refundAcrossPayments } from '@/lib/payments/refund'
import { queryMany } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { queueAdsConversion } from '@/lib/google-ads/conversions/queue'

const refund = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  refund.mockImplementation(async (_id: string, o: { amount: number }) => ({ id: `rfnd_${o.amount}` }))
  vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: { payments: { refund } } } as any)
})

describe('refundAcrossPayments', () => {
  it('spreads a partial refund over payments and re-checks the Google Ads conversion value', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'p1', transaction_id: 'pay_1', amount: '300', gateway_response: { partial_refunds: [{ amount: 100 }] } },
      { id: 'p2', transaction_id: 'pay_2', amount: '500', gateway_response: {} },
    ] as any)
    const r = await refundAcrossPayments({ orderId: 'o1', amount: 250, orderRef: 'ORD-1', purpose: 'order_adjustment' })
    expect(r.refunded).toBe(250)
    expect(refund.mock.calls.map(c => [c[0], c[1].amount])).toEqual([
      ['pay_1', 20000],
      ['pay_2', 5000],
    ])
    expect(queueAdsConversion).toHaveBeenCalledWith('o1')
  })

  it('still re-checks the conversion when only part of the refund went out', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'p1', transaction_id: 'pay_1', amount: '100', gateway_response: {} }] as any)
    await expect(refundAcrossPayments({ orderId: 'o1', amount: 250, orderRef: 'ORD-1', purpose: 'x' })).rejects.toThrow(/could be refunded/)
    expect(queueAdsConversion).toHaveBeenCalledWith('o1')
  })
})
