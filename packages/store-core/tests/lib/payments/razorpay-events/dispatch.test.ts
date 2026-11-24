import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/subscriptions/cycle', () => ({ processSubscriptionEvent: vi.fn() }))
vi.mock('@/lib/payments/webhook-tenant', () => ({
  resolveSubscriptionTenant: vi.fn(),
  runInTenant: vi.fn((_t: unknown, fn: () => Promise<unknown>) => fn()),
}))
vi.mock('@/lib/payments/razorpay-events/payments', () => ({
  onPaymentCaptured: vi.fn(),
  onPaymentFailed: vi.fn(),
  onPaymentLinkExpired: vi.fn(),
  onPaymentLinkPaid: vi.fn(),
  onQrCodeCredited: vi.fn(),
}))
vi.mock('@/lib/payments/razorpay-events/refunds', () => ({ onRefund: vi.fn() }))
vi.mock('@/lib/payments/razorpay-events/disputes', () => ({ onDispute: vi.fn() }))
vi.mock('@/lib/payments/razorpay-events/settlements', () => ({ onSettlementProcessed: vi.fn(), onTransfer: vi.fn() }))
vi.mock('@/lib/payments/razorpay-events/downtime', () => ({ onDowntime: vi.fn() }))

import {
  verifyRazorpaySignature,
  dispatchRazorpayEvent,
  RAZORPAY_WEBHOOK_EVENTS,
  TransientWebhookError,
} from '@/lib/payments/razorpay-events/dispatch'
import { processSubscriptionEvent } from '@/lib/subscriptions/cycle'
import { resolveSubscriptionTenant, runInTenant } from '@/lib/payments/webhook-tenant'
import {
  onPaymentCaptured,
  onPaymentFailed,
  onPaymentLinkExpired,
  onPaymentLinkPaid,
  onQrCodeCredited,
} from '@/lib/payments/razorpay-events/payments'
import { onRefund } from '@/lib/payments/razorpay-events/refunds'
import { onDispute } from '@/lib/payments/razorpay-events/disputes'
import { onSettlementProcessed, onTransfer } from '@/lib/payments/razorpay-events/settlements'
import { onDowntime } from '@/lib/payments/razorpay-events/downtime'

const SECRET = 'test-webhook-secret'
const ctx = (over: Record<string, unknown> = {}) => ({ source: 'platform', store: null, eventId: 'evt_1', accountId: null, ...over }) as any
const store = { tenantId: 't1', slug: 'acme', ctx: null }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('verifyRazorpaySignature', () => {
  const body = JSON.stringify({ event: 'payment.captured' })
  const sign = (b: string, s: string) => crypto.createHmac('sha256', s).update(b).digest('hex')

  it('accepts a valid HMAC-SHA256 signature of the raw body', () => {
    expect(verifyRazorpaySignature(body, sign(body, SECRET), SECRET)).toBe(true)
  })

  it('rejects a wrong signature (same length)', () => {
    expect(verifyRazorpaySignature(body, sign(body, 'other-secret'), SECRET)).toBe(false)
  })

  it('rejects a signature of a different length without throwing', () => {
    expect(verifyRazorpaySignature(body, 'short', SECRET)).toBe(false)
    expect(verifyRazorpaySignature(body, '', SECRET)).toBe(false)
  })

  it('rejects when body is tampered', () => {
    const good = sign(body, SECRET)
    expect(verifyRazorpaySignature(body + 'x', good, SECRET)).toBe(false)
  })
})

describe('RAZORPAY_WEBHOOK_EVENTS', () => {
  it('lists transfers as platformOnly and payment.captured as not', () => {
    const transfer = RAZORPAY_WEBHOOK_EVENTS.find(e => e.event === 'transfer.processed')
    const captured = RAZORPAY_WEBHOOK_EVENTS.find(e => e.event === 'payment.captured')
    expect(transfer?.platformOnly).toBe(true)
    expect(captured?.platformOnly).toBeUndefined()
    expect(RAZORPAY_WEBHOOK_EVENTS.some(e => e.event === 'subscription.charged')).toBe(true)
    expect(RAZORPAY_WEBHOOK_EVENTS.some(e => e.event === 'payment.dispute.lost')).toBe(true)
  })
})

describe('dispatchRazorpayEvent routing', () => {
  it('routes payment.captured to onPaymentCaptured with the payment entity', async () => {
    const c = ctx()
    await dispatchRazorpayEvent({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } }, c)
    expect(onPaymentCaptured).toHaveBeenCalledWith({ id: 'pay_1' }, c)
  })

  it('routes payment.failed to onPaymentFailed', async () => {
    await dispatchRazorpayEvent({ event: 'payment.failed', payload: { payment: { entity: { id: 'p' } } } }, ctx())
    expect(onPaymentFailed).toHaveBeenCalledWith({ id: 'p' }, expect.anything())
  })

  it('routes payment_link.paid with both link and payment', async () => {
    await dispatchRazorpayEvent(
      { event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'pl' } }, payment: { entity: { id: 'pay' } } } },
      ctx()
    )
    expect(onPaymentLinkPaid).toHaveBeenCalledWith({ id: 'pl' }, { id: 'pay' }, expect.anything())
  })

  it('routes payment_link.expired', async () => {
    await dispatchRazorpayEvent({ event: 'payment_link.expired', payload: { payment_link: { entity: { id: 'pl' } } } }, ctx())
    expect(onPaymentLinkExpired).toHaveBeenCalledWith({ id: 'pl' }, expect.anything())
  })

  it('routes qr_code.credited with qr and payment', async () => {
    await dispatchRazorpayEvent(
      { event: 'qr_code.credited', payload: { qr_code: { entity: { id: 'qr' } }, payment: { entity: { id: 'pay' } } } },
      ctx()
    )
    expect(onQrCodeCredited).toHaveBeenCalledWith({ id: 'qr' }, { id: 'pay' }, expect.anything())
  })

  it.each(['refund.created', 'refund.processed', 'refund.failed', 'refund.speed_changed'])('routes %s to onRefund with the type', async type => {
    await dispatchRazorpayEvent({ event: type, payload: { refund: { entity: { id: 'r' } }, payment: { entity: { id: 'p' } } } }, ctx())
    expect(onRefund).toHaveBeenCalledWith(type, { id: 'r' }, { id: 'p' }, expect.anything())
  })

  it('routes settlement.processed', async () => {
    await dispatchRazorpayEvent({ event: 'settlement.processed', payload: { settlement: { entity: { id: 's' } } } }, ctx())
    expect(onSettlementProcessed).toHaveBeenCalledWith({ id: 's' }, expect.anything())
  })

  it.each(['payment.downtime.started', 'payment.downtime.updated', 'payment.downtime.resolved'])('routes %s to onDowntime', async type => {
    await dispatchRazorpayEvent({ event: type, payload: { 'payment.downtime': { entity: { id: 'd' } } } }, ctx())
    expect(onDowntime).toHaveBeenCalledWith(type, { id: 'd' }, expect.anything())
  })

  it.each(['transfer.processed', 'transfer.failed', 'transfer.reversed'])('routes %s to onTransfer', async type => {
    await dispatchRazorpayEvent({ event: type, payload: { transfer: { entity: { id: 'trf' } } } }, ctx())
    expect(onTransfer).toHaveBeenCalledWith({ id: 'trf' }, expect.anything())
  })

  it('routes a dispute event to onDispute', async () => {
    await dispatchRazorpayEvent(
      { event: 'payment.dispute.created', payload: { dispute: { entity: { id: 'd' } }, payment: { entity: { id: 'p' } } } },
      ctx()
    )
    expect(onDispute).toHaveBeenCalledWith('payment.dispute.created', { id: 'd' }, { id: 'p' }, expect.anything())
  })

  it('ignores an unknown event type (no handler fires)', async () => {
    await dispatchRazorpayEvent({ event: 'order.paid', payload: {} }, ctx())
    expect(onPaymentCaptured).not.toHaveBeenCalled()
    expect(onRefund).not.toHaveBeenCalled()
    expect(onDispute).not.toHaveBeenCalled()
  })

  it('handles a missing event/payload gracefully', async () => {
    await expect(dispatchRazorpayEvent({}, ctx())).resolves.toBeUndefined()
    await expect(dispatchRazorpayEvent(null, ctx())).resolves.toBeUndefined()
  })
})

describe('subscription events', () => {
  const subEvt = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1' } } } }

  it('on platform: resolves tenant, runs processSubscriptionEvent in tenant', async () => {
    vi.mocked(resolveSubscriptionTenant).mockResolvedValue(store as any)
    vi.mocked(processSubscriptionEvent).mockResolvedValue(true as any)
    await dispatchRazorpayEvent(subEvt, ctx({ source: 'platform' }))
    expect(resolveSubscriptionTenant).toHaveBeenCalledWith({ id: 'sub_1' })
    expect(runInTenant).toHaveBeenCalled()
    expect(processSubscriptionEvent).toHaveBeenCalledWith('subscription.charged', subEvt, { tenantId: 't1', slug: 'acme' })
  })

  it('on own account: uses ctx.store, skips tenant resolution', async () => {
    vi.mocked(processSubscriptionEvent).mockResolvedValue(true as any)
    await dispatchRazorpayEvent(subEvt, ctx({ source: 'own', store }))
    expect(resolveSubscriptionTenant).not.toHaveBeenCalled()
    expect(processSubscriptionEvent).toHaveBeenCalled()
  })

  it('ack-and-drops when the subscription tenant is unknown', async () => {
    vi.mocked(resolveSubscriptionTenant).mockResolvedValue(null)
    await dispatchRazorpayEvent(subEvt, ctx({ source: 'platform' }))
    expect(processSubscriptionEvent).not.toHaveBeenCalled()
  })

  it('ack-and-drops (no throw) when processSubscriptionEvent returns not-known', async () => {
    vi.mocked(resolveSubscriptionTenant).mockResolvedValue(store as any)
    vi.mocked(processSubscriptionEvent).mockResolvedValue(false as any)
    await expect(dispatchRazorpayEvent(subEvt, ctx())).resolves.toBeUndefined()
  })

  it('wraps a tenant-resolution failure in TransientWebhookError', async () => {
    vi.mocked(resolveSubscriptionTenant).mockRejectedValue(new Error('cp down'))
    await expect(dispatchRazorpayEvent(subEvt, ctx({ source: 'platform' }))).rejects.toBeInstanceOf(TransientWebhookError)
  })

  it('wraps an in-tenant handler failure in TransientWebhookError', async () => {
    vi.mocked(resolveSubscriptionTenant).mockResolvedValue(store as any)
    vi.mocked(processSubscriptionEvent).mockRejectedValue(new Error('boom'))
    await expect(dispatchRazorpayEvent(subEvt, ctx())).rejects.toBeInstanceOf(TransientWebhookError)
  })

  describe("a workspace's own billing subscription", () => {
    const billing = { tenantId: 't1', slug: '', ctx: null, collectingAccount: 'billing' }

    it('goes to the injected handler, never into a store', async () => {
      vi.mocked(resolveSubscriptionTenant).mockResolvedValue(billing as any)
      const onBillingSubscription = vi.fn().mockResolvedValue(undefined)
      await dispatchRazorpayEvent(subEvt, { ...ctx({ source: 'platform' }), eventId: 'evt_1', onBillingSubscription })
      expect(onBillingSubscription).toHaveBeenCalledWith('subscription.charged', subEvt, { tenantId: 't1', eventId: 'evt_1' })
      expect(processSubscriptionEvent).not.toHaveBeenCalled()
      expect(runInTenant).not.toHaveBeenCalled()
    })

    it('is acked and dropped without a handler', async () => {
      vi.mocked(resolveSubscriptionTenant).mockResolvedValue(billing as any)
      await expect(dispatchRazorpayEvent(subEvt, ctx({ source: 'platform' }))).resolves.toBeUndefined()
      expect(processSubscriptionEvent).not.toHaveBeenCalled()
    })

    it('a handler failure is retryable', async () => {
      vi.mocked(resolveSubscriptionTenant).mockResolvedValue(billing as any)
      const onBillingSubscription = vi.fn().mockRejectedValue(new Error('db down'))
      await expect(dispatchRazorpayEvent(subEvt, { ...ctx({ source: 'platform' }), onBillingSubscription })).rejects.toBeInstanceOf(TransientWebhookError)
    })
  })
})
