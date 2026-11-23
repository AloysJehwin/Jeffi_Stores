import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/payments/wallet', () => ({
  isFlagshipTenant: (id: string | null | undefined) => !id || id === '00000000-0000-0000-0000-000000000000',
}))

import {
  getMessagingAddon,
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

describe('getMessagingAddon', () => {
  it('reads the tier and period the billing handler wrote (no renew flag: it is a subscription line)', async () => {
    const until = new Date(Date.now() + 10 * 86_400_000)
    query.mockResolvedValueOnce({ rows: [{ messaging_addon: 'both', messaging_addon_until: until, active: true }] })
    expect(await getMessagingAddon(T)).toEqual({ tier: 'both', active: true, until: until.toISOString() })
  })

  it('keys a wallet-paid month from before the switch (the migration credits from it)', () => {
    expect(messagingAddonRef(T, 'both', '2026-12-01')).toBe(`messaging_addon:${T}:both:2026-12-01`)
  })
})
