import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
const debitWallet = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/payments/wallet', () => ({
  debitWallet: (o: unknown) => debitWallet(o),
  isFlagshipTenant: (id: string | null | undefined) => !id || id === '00000000-0000-0000-0000-000000000000',
}))

import {
  buyMessagingAddonMonth,
  invalidateMessagingEntitlement,
  messagingAddonRef,
  messagingEntitlement,
} from '@/lib/billing/messaging-addon'

const T = '11111111-1111-1111-1111-111111111111'
const row = (o: Record<string, unknown>) => ({ rows: [{ tier: 'none', active: false, sms_sender: false, wa_sender: false, ...o }] })

beforeEach(() => {
  vi.clearAllMocks()
  invalidateMessagingEntitlement()
})

describe('messagingEntitlement', () => {
  it('is ok for the flagship without reading the control plane', async () => {
    expect(await messagingEntitlement(null)).toEqual({ sms: 'ok', whatsapp: 'ok' })
    expect(await messagingEntitlement('00000000-0000-0000-0000-000000000000')).toEqual({ sms: 'ok', whatsapp: 'ok' })
    expect(query).not.toHaveBeenCalled()
  })

  it('locks both channels on the add-on when none is bought, or it has lapsed', async () => {
    query.mockResolvedValueOnce(row({}))
    expect(await messagingEntitlement(T)).toEqual({ sms: 'addon', whatsapp: 'addon' })
    invalidateMessagingEntitlement(T)
    query.mockResolvedValueOnce(row({ tier: 'both', active: false, sms_sender: true, wa_sender: true }))
    expect(await messagingEntitlement(T)).toEqual({ sms: 'addon', whatsapp: 'addon' })
  })

  it('waits for the number when the tier covers a channel with no sender', async () => {
    query.mockResolvedValueOnce(row({ tier: 'sms', active: true }))
    expect(await messagingEntitlement(T)).toEqual({ sms: 'number', whatsapp: 'addon' })
  })

  it('is ok with the tier and a sender, and caches the answer', async () => {
    query.mockResolvedValueOnce(row({ tier: 'both', active: true, sms_sender: true, wa_sender: false }))
    expect(await messagingEntitlement(T)).toEqual({ sms: 'ok', whatsapp: 'number' })
    await messagingEntitlement(T)
    expect(query).toHaveBeenCalledTimes(1)
  })
})

describe('buyMessagingAddonMonth', () => {
  const status = (o: Record<string, unknown>) => ({ rows: [{ messaging_addon: 'none', messaging_addon_until: null, messaging_addon_renew: false, active: false, ...o }] })

  it('keys the charge on tenant, tier and the period start', async () => {
    query.mockResolvedValue(status({}))
    debitWallet.mockResolvedValue({ ok: true, charged: true, balance: 0 })
    const r = await buyMessagingAddonMonth(T, { tier: 'both', renew: true, reason: 'purchase' })
    expect(r.ok).toBe(true)
    const today = new Date().toISOString().slice(0, 10)
    expect(debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({ amountInr: 142, category: 'messaging_addon', externalRef: messagingAddonRef(T, 'both', today), floorInr: 0 })
    )
  })

  it('extends the same tier from the current end, and starts a changed tier from today', async () => {
    const until = new Date(Date.now() + 10 * 86_400_000)
    query.mockResolvedValue(status({ messaging_addon: 'sms', messaging_addon_until: until, active: true }))
    debitWallet.mockResolvedValue({ ok: true, charged: true, balance: 0 })
    await buyMessagingAddonMonth(T, { tier: 'sms', renew: true, reason: 'renewal' })
    expect(debitWallet.mock.calls[0][0].externalRef).toBe(messagingAddonRef(T, 'sms', until.toISOString().slice(0, 10)))
    await buyMessagingAddonMonth(T, { tier: 'both', renew: true, reason: 'purchase' })
    expect(debitWallet.mock.calls[1][0].externalRef).toBe(messagingAddonRef(T, 'both', new Date().toISOString().slice(0, 10)))
  })

  it('refuses the flagship and passes a short wallet through', async () => {
    expect((await buyMessagingAddonMonth('00000000-0000-0000-0000-000000000000', { tier: 'sms', renew: true, reason: 'purchase' })).ok).toBe(false)
    query.mockResolvedValue(status({}))
    debitWallet.mockResolvedValue({ ok: false, error: 'short' })
    expect(await buyMessagingAddonMonth(T, { tier: 'sms', renew: true, reason: 'purchase' })).toEqual({ ok: false, error: 'short' })
  })
})
