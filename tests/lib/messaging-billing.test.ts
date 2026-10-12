import { vi, describe, it, expect, beforeEach } from 'vitest'

const debitWallet = vi.hoisted(() => vi.fn())
const debitMessaging = vi.hoisted(() => vi.fn())
const getWalletBalance = vi.hoisted(() => vi.fn())
vi.mock('@/lib/payments/wallet', () => ({
  debitWallet,
  debitMessaging,
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
  it('trues up to the exact price on a sid-keyed external ref', async () => {
    debitMessaging.mockResolvedValue(undefined)
    await debitMessageCost({ tenantId: 't1', channel: 'sms', providerSid: 'SM1', priceInr: 7 })
    expect(debitMessaging).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', amountInr: 7, category: 'sms', externalRef: 'msg:SM1', trueUp: true })
    )
  })

  it('is a no-op for a non-positive price', async () => {
    await debitMessageCost({ tenantId: 't1', channel: 'sms', providerSid: 'SM1', priceInr: 0 })
    expect(debitMessaging).not.toHaveBeenCalled()
  })
})
