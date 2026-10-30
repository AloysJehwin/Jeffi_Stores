import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchTransfer = vi.fn()
const mockReverse = vi.fn()
const pool = { query: vi.fn() }

vi.mock('@/lib/payments/razorpay', () => ({
  getRazorpayInstance: () => ({
    payments: { fetchTransfer: mockFetchTransfer },
    transfers: { reverse: mockReverse },
  }),
}))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => pool }))

import { fetchTransfersForPayment } from '@/lib/payments/razorpay-route'
import { syncRouteReversals } from '@/lib/payments/route-settlement'

// A tenant_transactions row as route-settlement reads it. gross/refunded drive the proportional
// reversal target; reverseTransfer is the Razorpay call route-settlement makes.
function txnRow(over: Record<string, any> = {}) {
  return {
    id: 'txn-1',
    tenant_id: 't-1',
    order_ref: 'ORD-1',
    gross_amount: 500,
    tenant_share: 500,
    platform_commission: 0,
    gateway_fee: 0,
    is_cod: false,
    gateway: 'razorpay_route',
    gateway_txn_id: 'pay_1',
    status: 'split',
    payment_id: 'pay_1',
    transfer_id: null,
    refunded_amount: 0,
    reversed_amount: 0,
    ...over,
  }
}

// syncRouteReversals: SELECT the row (twice: once before the lock, once inside), take an advisory
// lock, UPDATE reversed_amount, and insert ledger rows. Route SELECTs to the row and everything
// else to an empty result.
function wirePool(row: any) {
  pool.query.mockImplementation((sql: string) => {
    if (/FROM tenant_transactions WHERE id =/.test(sql)) return Promise.resolve({ rows: [row] })
    return Promise.resolve({ rows: [] })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReverse.mockResolvedValue({ id: 'rvr_1' })
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

describe('syncRouteReversals', () => {
  it('reverses the transfer NET share proportionally to the refund, never the buyer gross', async () => {
    // Buyer gross 500, fully refunded; the transfer only carried the tenant's net share (386p).
    wirePool(txnRow({ gross_amount: 500, refunded_amount: 500 }))
    mockFetchTransfer.mockResolvedValueOnce({ items: [{ id: 'trf_x', amount: 386, amount_reversed: 0 }] })
    const out = await syncRouteReversals('txn-1')
    expect(mockReverse).toHaveBeenCalledWith('trf_x', { amount: 386 })
    expect(mockReverse).not.toHaveBeenCalledWith('trf_x', { amount: 500 })
    expect(out.reversedPaise).toBe(386)
    expect(out.unrecoveredPaise).toBe(0)
  })

  it('reverses only the proportional share on a PARTIAL refund', async () => {
    // Gross 1000, refunded 250 (25%) → reverse 25% of the 1000p transfer = 250p.
    wirePool(txnRow({ gross_amount: 1000, refunded_amount: 250 }))
    mockFetchTransfer.mockResolvedValueOnce({ items: [{ id: 'trf_p', amount: 1000, amount_reversed: 0 }] })
    const out = await syncRouteReversals('txn-1')
    expect(mockReverse).toHaveBeenCalledWith('trf_p', { amount: 250 })
    expect(out.reversedPaise).toBe(250)
  })

  it('reverses only the outstanding delta when already partly reversed (idempotent)', async () => {
    // Fully refunded, 1000p transfer, 700p already reversed → only 300p left to reverse.
    wirePool(txnRow({ gross_amount: 1000, refunded_amount: 1000 }))
    mockFetchTransfer.mockResolvedValueOnce({ items: [{ id: 'trf_y', amount: 1000, amount_reversed: 700 }] })
    const out = await syncRouteReversals('txn-1')
    expect(mockReverse).toHaveBeenCalledWith('trf_y', { amount: 300 })
    expect(out.reversedPaise).toBe(300)
  })

  it('spreads across multiple transfers', async () => {
    wirePool(txnRow({ gross_amount: 700, refunded_amount: 700 }))
    mockFetchTransfer.mockResolvedValueOnce({
      items: [
        { id: 'trf_a', amount: 300, amount_reversed: 0 },
        { id: 'trf_b', amount: 400, amount_reversed: 0 },
      ],
    })
    const out = await syncRouteReversals('txn-1')
    expect(mockReverse).toHaveBeenCalledWith('trf_a', { amount: 300 })
    expect(mockReverse).toHaveBeenCalledWith('trf_b', { amount: 400 })
    expect(out.reversedPaise).toBe(700)
  })

  it('reports the shortfall instead of throwing when the linked account is empty', async () => {
    wirePool(txnRow({ gross_amount: 500, refunded_amount: 500 }))
    mockFetchTransfer.mockResolvedValueOnce({ items: [{ id: 'trf_z', amount: 386, amount_reversed: 0 }] })
    mockReverse.mockRejectedValueOnce(new Error('insufficient balance'))
    const out = await syncRouteReversals('txn-1')
    expect(out.reversedPaise).toBe(0)
    expect(out.unrecoveredPaise).toBe(386)
  })

  it('treats a failed lookup as unrecovered so the retry revisits it', async () => {
    wirePool(txnRow({ gross_amount: 700, refunded_amount: 700, tenant_share: 700 }))
    mockFetchTransfer.mockRejectedValueOnce(new Error('timeout'))
    const out = await syncRouteReversals('txn-1')
    expect(out.unrecoveredPaise).toBe(70000) // tenant_share ₹700 -> 70000 paise
    expect(out.lookupError).toBeTruthy()
    expect(mockReverse).not.toHaveBeenCalled()
  })

  it('does nothing when nothing is refunded', async () => {
    wirePool(txnRow({ gross_amount: 500, refunded_amount: 0 }))
    const out = await syncRouteReversals('txn-1')
    expect(mockReverse).not.toHaveBeenCalled()
    expect(out).toEqual({ reversedPaise: 0, unrecoveredPaise: 0 })
  })
})
