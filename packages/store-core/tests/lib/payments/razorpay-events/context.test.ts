import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/payments/webhook-tenant', () => ({
  flagshipScope: vi.fn(),
  runInTenant: vi.fn((_t: unknown, fn: () => Promise<unknown>) => fn()),
  scopeForEntity: vi.fn(),
  storeForRazorpayOrder: vi.fn(),
}))

import { storeFor, inPaymentStore, TransientWebhookError } from '@/lib/payments/razorpay-events/context'
import { flagshipScope, runInTenant, scopeForEntity, storeForRazorpayOrder } from '@/lib/payments/webhook-tenant'

const platform = { tenantId: '00000000-0000-0000-0000-000000000000', slug: 'platform', ctx: null }
const storeA = { tenantId: 'tA', slug: 'a', ctx: null }
const storeB = { tenantId: 'tB', slug: 'b', ctx: null }

const ctx = (over: Record<string, unknown> = {}) => ({ source: 'platform', store: null, eventId: 'e', accountId: null, ...over }) as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('storeFor', () => {
  describe('own account', () => {
    it("returns the ctx store when notes name no other store", async () => {
      const r = await storeFor(ctx({ source: 'own', store: storeA }), { id: 'x' })
      expect(r).toBe(storeA)
      expect(scopeForEntity).not.toHaveBeenCalled()
    })

    it('returns the store when the entity notes name this same store', async () => {
      const r = await storeFor(ctx({ source: 'own', store: storeA }), { notes: { tenant_id: 'tA' } })
      expect(r).toBe(storeA)
    })

    it('drops (null) when entity notes name a different store', async () => {
      const r = await storeFor(ctx({ source: 'own', store: storeA }), { notes: { tenant_id: 'tOther' } })
      expect(r).toBeNull()
    })

    it("drops when the payment's notes name a different store", async () => {
      const r = await storeFor(ctx({ source: 'own', store: storeA }), { id: 'x' }, { payment: { notes: { tenant_id: 'tOther' } } })
      expect(r).toBeNull()
    })
  })

  describe('platform account', () => {
    it('delegates to scopeForEntity and returns its result', async () => {
      vi.mocked(scopeForEntity).mockResolvedValue(storeB as any)
      const r = await storeFor(ctx({ source: 'platform' }), { id: 'x' }, { paymentId: 'pay_1' })
      expect(scopeForEntity).toHaveBeenCalledWith({ id: 'x' }, { paymentId: 'pay_1' })
      expect(r).toBe(storeB)
    })

    it('wraps a scopeForEntity failure in TransientWebhookError', async () => {
      vi.mocked(scopeForEntity).mockRejectedValue(new Error('cp down'))
      await expect(storeFor(ctx({ source: 'platform' }), { id: 'x' })).rejects.toBeInstanceOf(TransientWebhookError)
    })
  })
})

describe('inPaymentStore', () => {
  it('runs fn in the matched store and returns its outcome', async () => {
    vi.mocked(scopeForEntity).mockResolvedValue(storeA as any)
    const fn = vi.fn(async () => 'captured')
    const out = await inPaymentStore(ctx(), { id: 'p', order_id: 'o1' }, fn)
    expect(out).toBe('captured')
    expect(runInTenant).toHaveBeenCalledWith(storeA, expect.any(Function))
    expect(fn).toHaveBeenCalledWith(storeA)
  })

  it('returns "unmatched" with no store and makes no order fallback on own account', async () => {
    vi.mocked(scopeForEntity).mockResolvedValue(null)
    const fn = vi.fn(async () => 'x')
    const out = await inPaymentStore(ctx({ source: 'own', store: null }), { id: 'p' }, fn)
    expect(out).toBe('unmatched')
    expect(fn).not.toHaveBeenCalled()
    expect(storeForRazorpayOrder).not.toHaveBeenCalled()
  })

  it('returns the first outcome unchanged when it matched (no fallback)', async () => {
    vi.mocked(scopeForEntity).mockResolvedValue(storeA as any)
    const out = await inPaymentStore(ctx(), { id: 'p', order_id: 'o1' }, async () => 'captured')
    expect(out).toBe('captured')
    expect(storeForRazorpayOrder).not.toHaveBeenCalled()
  })

  it('falls back to the order store on platform when first was unmatched', async () => {
    vi.mocked(scopeForEntity).mockResolvedValue(null)
    vi.mocked(storeForRazorpayOrder).mockResolvedValue(storeB as any)
    const fn = vi.fn(async (s: any) => (s === storeB ? 'captured' : 'unmatched'))
    const out = await inPaymentStore(ctx(), { id: 'p', order_id: 'o9' }, fn)
    expect(storeForRazorpayOrder).toHaveBeenCalledWith('o9')
    expect(out).toBe('captured')
  })

  it('uses flagshipScope when the order lookup is undefined', async () => {
    vi.mocked(scopeForEntity).mockResolvedValue(null)
    vi.mocked(storeForRazorpayOrder).mockResolvedValue(undefined)
    vi.mocked(flagshipScope).mockReturnValue(platform as any)
    const fn = vi.fn(async () => 'captured')
    const out = await inPaymentStore(ctx(), { id: 'p', order_id: 'o9' }, fn)
    expect(flagshipScope).toHaveBeenCalled()
    expect(fn).toHaveBeenCalledWith(platform)
    expect(out).toBe('captured')
  })

  it('does not re-run when the order store equals the first store', async () => {
    // first store matched is null => first tenantId undefined; byOrder null => second null => stays unmatched
    vi.mocked(scopeForEntity).mockResolvedValue(null)
    vi.mocked(storeForRazorpayOrder).mockResolvedValue(null)
    const fn = vi.fn(async () => 'unmatched')
    const out = await inPaymentStore(ctx(), { id: 'p', order_id: 'o9' }, fn)
    expect(out).toBe('unmatched')
    expect(fn).not.toHaveBeenCalled()
  })

  it('wraps an order lookup failure in TransientWebhookError', async () => {
    vi.mocked(scopeForEntity).mockResolvedValue(null)
    vi.mocked(storeForRazorpayOrder).mockRejectedValue(new Error('boom'))
    await expect(inPaymentStore(ctx(), { id: 'p', order_id: 'o9' }, async () => 'unmatched')).rejects.toBeInstanceOf(
      TransientWebhookError
    )
  })
})

describe('TransientWebhookError', () => {
  it('keeps the cause and name', () => {
    const cause = new Error('inner')
    const e = new TransientWebhookError('msg', cause)
    expect(e.name).toBe('TransientWebhookError')
    expect(e.cause).toBe(cause)
    expect(e.message).toBe('msg')
  })
})
