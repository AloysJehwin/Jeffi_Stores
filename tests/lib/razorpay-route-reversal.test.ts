import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchTransfer = vi.fn()
const mockReverse = vi.fn()

vi.mock('@/lib/payments/razorpay', () => ({
  getRazorpayInstance: () => ({
    payments: { fetchTransfer: mockFetchTransfer },
    transfers: { reverse: mockReverse },
  }),
}))

import { reverseTransfersForRefund, fetchTransfersForPayment } from '@/lib/payments/razorpay-route'

beforeEach(() => {
  vi.clearAllMocks()
  mockReverse.mockResolvedValue(undefined)
})

describe('fetchTransfersForPayment', () => {
  it('distinguishes a failed lookup from no transfers', async () => {
    mockFetchTransfer.mockRejectedValueOnce(new Error('network'))
    const failed = await fetchTransfersForPayment('pay_1')
    expect(failed.ok).toBe(false)

    mockFetchTransfer.mockResolvedValueOnce({ items: [] })
    const empty = await fetchTransfersForPayment('pay_1')
    expect(empty).toEqual({ ok: true, transfers: [] })
  })

  it('returns every transfer, not just the first', async () => {
    mockFetchTransfer.mockResolvedValueOnce({
      items: [
        { id: 'trf_a', amount: 300, amount_reversed: 0 },
        { id: 'trf_b', amount: 200, amount_reversed: 0 },
      ],
    })
    const res = await fetchTransfersForPayment('pay_1')
    expect(res.ok && res.transfers.map(t => t.id)).toEqual(['trf_a', 'trf_b'])
  })
})

describe('reverseTransfersForRefund', () => {
  it('reverses the transfer NET amount, never the buyer gross', async () => {
    // Buyer paid 50000p but the transfer only carried the tenant's net share.
    mockFetchTransfer.mockResolvedValueOnce({ items: [{ id: 'trf_x', amount: 386, amount_reversed: 0 }] })
    const out = await reverseTransfersForRefund('pay_1', 50000)
    expect(mockReverse).toHaveBeenCalledWith('trf_x', { amount: 386 })
    expect(mockReverse).not.toHaveBeenCalledWith('trf_x', { amount: 50000 })
    expect(out.reversedPaise).toBe(386)
    expect(out.unrecoveredPaise).toBe(0)
  })

  it('caps at the remaining amount when partly reversed already', async () => {
    mockFetchTransfer.mockResolvedValueOnce({ items: [{ id: 'trf_y', amount: 386, amount_reversed: 286 }] })
    await reverseTransfersForRefund('pay_1', 50000)
    expect(mockReverse).toHaveBeenCalledWith('trf_y', { amount: 100 })
  })

  it('reverses only the refunded amount on a PARTIAL refund', async () => {
    mockFetchTransfer.mockResolvedValueOnce({ items: [{ id: 'trf_p', amount: 1000, amount_reversed: 0 }] })
    const out = await reverseTransfersForRefund('pay_1', 250)
    expect(mockReverse).toHaveBeenCalledWith('trf_p', { amount: 250 })
    expect(out.reversedPaise).toBe(250)
  })

  it('spreads across multiple transfers', async () => {
    mockFetchTransfer.mockResolvedValueOnce({
      items: [
        { id: 'trf_a', amount: 300, amount_reversed: 0 },
        { id: 'trf_b', amount: 400, amount_reversed: 0 },
      ],
    })
    const out = await reverseTransfersForRefund('pay_1', 500)
    expect(mockReverse).toHaveBeenNthCalledWith(1, 'trf_a', { amount: 300 })
    expect(mockReverse).toHaveBeenNthCalledWith(2, 'trf_b', { amount: 200 })
    expect(out.reversedPaise).toBe(500)
  })

  it('reports the shortfall instead of throwing when the linked account is empty', async () => {
    mockFetchTransfer.mockResolvedValueOnce({ items: [{ id: 'trf_z', amount: 386, amount_reversed: 0 }] })
    mockReverse.mockRejectedValueOnce(new Error('insufficient balance'))
    const out = await reverseTransfersForRefund('pay_1', 50000)
    expect(out.reversedPaise).toBe(0)
    expect(out.unrecoveredPaise).toBe(386)
    expect(out.perTransfer[0].error).toMatch(/insufficient/i)
  })

  it('treats a failed lookup as fully unrecovered so the retry revisits it', async () => {
    mockFetchTransfer.mockRejectedValueOnce(new Error('timeout'))
    const out = await reverseTransfersForRefund('pay_1', 700)
    expect(out.unrecoveredPaise).toBe(700)
    expect(out.lookupError).toBeTruthy()
    expect(mockReverse).not.toHaveBeenCalled()
  })

  it('does nothing when the payment has no transfers', async () => {
    mockFetchTransfer.mockResolvedValueOnce({ items: [] })
    const out = await reverseTransfersForRefund('pay_1', 500)
    expect(mockReverse).not.toHaveBeenCalled()
    expect(out).toEqual({ reversedPaise: 0, unrecoveredPaise: 0, perTransfer: [] })
  })
})
