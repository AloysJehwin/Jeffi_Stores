import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryOne = vi.fn<(...a: any[]) => any>(async () => null as any)
vi.mock('@/lib/shared/db', () => ({ queryOne: (t: string, p?: any[]) => queryOne(t, p) }))
vi.mock('@/lib/subscriptions/autopay', () => ({
  advanceRedemption: vi.fn(async () => {}),
  syncAutopaySetup: vi.fn(async () => {}),
  syncAutopaySubscription: vi.fn(async () => {}),
}))

import { isAutopayEvent, handleAutopayWebhook } from '@/lib/payments/upi/autopay-webhook'
import { advanceRedemption, syncAutopaySetup, syncAutopaySubscription } from '@/lib/subscriptions/autopay'

const NIL = '00000000-0000-0000-0000-000000000000'
const T = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  queryOne.mockResolvedValue(null)
})

describe('isAutopayEvent', () => {
  it('only subscription.* events', () => {
    expect(isAutopayEvent('subscription.paused')).toBe(true)
    expect(isAutopayEvent('checkout.order.completed')).toBe(false)
  })
})

describe('handleAutopayWebhook — mandate setup (checkout.*)', () => {
  it('handled false when no merchantOrderId', async () => {
    expect(await handleAutopayWebhook({ event: 'checkout.order.completed', payload: {} })).toEqual({ handled: false })
  })
  it('handled false when no matching subscription', async () => {
    queryOne.mockResolvedValueOnce(null)
    expect(await handleAutopayWebhook({ event: 'checkout.order.completed', payload: { merchantOrderId: 'JSm' } })).toEqual({ handled: false })
  })
  it('syncs the setup for the store, dropping the nil tenant to flagship', async () => {
    queryOne.mockResolvedValueOnce({ id: 'sub1' })
    expect(await handleAutopayWebhook({ event: 'checkout.order.completed', payload: { merchantOrderId: 'JSm' } }, { store: { tenantId: T, slug: 'acme' } })).toEqual({ handled: true })
    expect(syncAutopaySetup).toHaveBeenCalledWith('sub1', { store: { tenantId: T, slug: 'acme' } })

    queryOne.mockResolvedValueOnce({ id: 'sub2' })
    await handleAutopayWebhook({ event: 'checkout.order.completed', payload: { merchantOrderId: 'JSm' } }, { store: { tenantId: NIL } })
    expect(vi.mocked(syncAutopaySetup).mock.calls[1][1]).toEqual({ store: null })
  })
})

describe('handleAutopayWebhook — notification / redemption', () => {
  it('handled false when the event is neither autopay nor checkout', async () => {
    expect(await handleAutopayWebhook({ event: 'pg.refund.completed', payload: {} })).toEqual({ handled: false })
  })
  it('handled false without a merchantOrderId', async () => {
    expect(await handleAutopayWebhook({ event: 'subscription.redemption.order.completed', payload: {} })).toEqual({ handled: false })
  })
  it('handled false when the redemption row is missing', async () => {
    queryOne.mockResolvedValueOnce(null)
    expect(await handleAutopayWebhook({ event: 'subscription.notification.completed', payload: { merchantOrderId: 'JSm' } })).toEqual({ handled: false })
  })
  it('advances the redemption when found', async () => {
    queryOne.mockResolvedValueOnce({ id: 'r1' })
    expect(await handleAutopayWebhook({ event: 'subscription.redemption.order.completed', payload: { merchantOrderId: 'JSm' } }, { store: { tenantId: T } })).toEqual({ handled: true })
    expect(advanceRedemption).toHaveBeenCalledWith('r1', { tenantId: T, slug: '' })
  })
})

describe('handleAutopayWebhook — mandate state (paused / cancelled / …)', () => {
  it('handled false without a merchantSubscriptionId', async () => {
    expect(await handleAutopayWebhook({ event: 'subscription.paused', payload: {} })).toEqual({ handled: false })
  })
  it('reads msid from the nested paymentFlow too; false when no subscription', async () => {
    queryOne.mockResolvedValueOnce(null)
    expect(await handleAutopayWebhook({ event: 'subscription.cancelled', payload: { paymentFlow: { merchantSubscriptionId: 'msid' } } })).toEqual({ handled: false })
    expect(queryOne.mock.calls[0][1]).toEqual(['msid'])
  })
  it('syncs the subscription when found', async () => {
    queryOne.mockResolvedValueOnce({ id: 'sub1' })
    expect(await handleAutopayWebhook({ event: 'SUBSCRIPTION.PAUSED', payload: { merchantSubscriptionId: 'msid' } })).toEqual({ handled: true })
    expect(syncAutopaySubscription).toHaveBeenCalledWith('sub1', null)
  })
})
