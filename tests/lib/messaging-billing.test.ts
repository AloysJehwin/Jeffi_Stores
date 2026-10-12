import { vi, describe, it, expect, beforeEach } from 'vitest'

const debitWallet = vi.hoisted(() => vi.fn())
const getWalletBalance = vi.hoisted(() => vi.fn())
vi.mock('@/lib/payments/wallet', () => ({
  debitWallet,
  getWalletBalance,
  isFlagshipTenant: (id: string | null | undefined) => !id || id === '00000000-0000-0000-0000-000000000000',
}))

import { checkMessagingBalance, debitMessageCost } from '@/lib/shared/messaging/billing'

beforeEach(() => vi.clearAllMocks())

describe('checkMessagingBalance', () => {
  it('passes when balance covers the estimate', async () => {
    getWalletBalance.mockResolvedValue({ balance: 100 })
    expect(await checkMessagingBalance({ tenantId: 't1', channel: 'sms', isMarketing: true })).toEqual({ ok: true })
  })

  it('blocks a MARKETING send when balance cannot cover the estimate', async () => {
    getWalletBalance.mockResolvedValue({ balance: 1 }) // < ₹7 sms estimate
    const r = await checkMessagingBalance({ tenantId: 't1', channel: 'sms', isMarketing: true })
    expect(r.ok).toBe(false)
  })

  it('never blocks a TRANSACTIONAL send even on empty balance', async () => {
    getWalletBalance.mockResolvedValue({ balance: 0 })
    expect(await checkMessagingBalance({ tenantId: 't1', channel: 'sms', isMarketing: false })).toEqual({ ok: true })
  })

  it('exempts flagship', async () => {
    expect(await checkMessagingBalance({ tenantId: null, channel: 'whatsapp', isMarketing: true })).toEqual({
      ok: true,
    })
    expect(getWalletBalance).not.toHaveBeenCalled()
  })

  it('fails OPEN for transactional and CLOSED for marketing when the wallet read throws', async () => {
    getWalletBalance.mockRejectedValue(new Error('cp down'))
    expect((await checkMessagingBalance({ tenantId: 't1', channel: 'sms', isMarketing: false })).ok).toBe(true)
    expect((await checkMessagingBalance({ tenantId: 't1', channel: 'sms', isMarketing: true })).ok).toBe(false)
  })
})

describe('debitMessageCost', () => {
  it('debits the exact price with a sid-keyed external ref and ₹0 floor', async () => {
    debitWallet.mockResolvedValue({ ok: true, charged: true, balance: 93 })
    await debitMessageCost({ tenantId: 't1', channel: 'sms', providerSid: 'SM1', priceInr: 7 })
    expect(debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', amountInr: 7, category: 'sms', externalRef: 'msg:SM1', floorInr: 0 })
    )
  })

  it('is a no-op for a non-positive price', async () => {
    await debitMessageCost({ tenantId: 't1', channel: 'sms', providerSid: 'SM1', priceInr: 0 })
    expect(debitWallet).not.toHaveBeenCalled()
  })
})
