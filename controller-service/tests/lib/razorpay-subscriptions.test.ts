/**
 * Tests for src/lib/payments/razorpay-subscriptions.ts: workspace billing on Razorpay Subscriptions. One combined
 * plan per cycle amount, keyed by key mode (test/live) and period; replacements keep the billing date with start_at
 * and collect proration as an upfront add-on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const rz = {
  plans: { create: vi.fn(), fetch: vi.fn() },
  subscriptions: { create: vi.fn(), fetch: vi.fn(), cancel: vi.fn(), update: vi.fn(), createAddon: vi.fn() },
  addons: { fetch: vi.fn(), delete: vi.fn() },
  payments: { refund: vi.fn() },
  invoices: { all: vi.fn() },
}
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: () => rz }))

const db = vi.hoisted(() => {
  const stored: Record<string, string> = {}
  const query = async (sql: string, params: any[] = []) => {
    if (sql.includes('INSERT INTO platform_infra')) {
      Object.assign(stored, JSON.parse(params[1]))
      return { rows: [] }
    }
    if (sql.includes('FROM platform_infra')) return { rows: Object.keys(stored).length ? [{ value: JSON.stringify(stored) }] : [] }
    return { rows: [] }
  }
  return { stored, query }
})
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: db.query }) }))

const env = { key: process.env.RAZORPAY_KEY_ID, period: process.env.BILLING_TEST_PERIOD }
beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  for (const k of Object.keys(db.stored)) delete db.stored[k]
  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc'
  delete process.env.BILLING_TEST_PERIOD
})
afterEach(() => {
  process.env.RAZORPAY_KEY_ID = env.key
  if (env.period === undefined) delete process.env.BILLING_TEST_PERIOD
  else process.env.BILLING_TEST_PERIOD = env.period
})

const subOpts = { interval: 'monthly' as const, amountPaise: 299900, ownerEmail: 'o@acme.in', notes: { tenant_id: 't-1', billing: '1' } }

describe('subscriptionPaise', () => {
  it('is the monthly price in paise, ten months for yearly', async () => {
    const { subscriptionPaise } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(subscriptionPaise(2999, 'monthly')).toBe(299900)
    expect(subscriptionPaise(2999, 'yearly')).toBe(2999000)
  })
})

describe('razorpayMode', () => {
  it('is test for rzp_test_ keys and live otherwise', async () => {
    const { razorpayMode } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(razorpayMode({ RAZORPAY_KEY_ID: 'rzp_test_x' })).toBe('test')
    expect(razorpayMode({ RAZORPAY_KEY_ID: 'rzp_live_x' })).toBe('live')
    expect(razorpayMode({})).toBe('live')
  })
})

describe('ensureCombinedPlan', () => {
  it('creates one plan per mode, period and amount and caches it in platform_infra', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_1' })
    const { ensureCombinedPlan, combinedPlanKey } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(await ensureCombinedPlan('monthly', 40000)).toBe('plan_1')
    expect(await ensureCombinedPlan('monthly', 40000)).toBe('plan_1')
    expect(rz.plans.create).toHaveBeenCalledTimes(1)
    const arg = rz.plans.create.mock.calls[0][0]
    expect(arg).toMatchObject({ period: 'monthly', interval: 1, item: { amount: 40000, currency: 'INR' } })
    expect(db.stored[combinedPlanKey('test', 'monthly', 40000)]).toBe('plan_1')
  })

  it('never reuses a test plan with live keys', async () => {
    rz.plans.create.mockResolvedValueOnce({ id: 'plan_test' }).mockResolvedValueOnce({ id: 'plan_live' })
    const mod = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(await mod.ensureCombinedPlan('monthly', 40000)).toBe('plan_test')
    process.env.RAZORPAY_KEY_ID = 'rzp_live_abc'
    expect(await mod.ensureCombinedPlan('monthly', 40000)).toBe('plan_live')
    expect(Object.keys(db.stored).sort()).toEqual(['combo:live:monthly:40000', 'combo:test:monthly:40000'])
  })

  it('reads a stored plan id after a restart', async () => {
    db.stored['combo:test:yearly:400000'] = 'plan_stored'
    const { ensureCombinedPlan } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(await ensureCombinedPlan('yearly', 400000)).toBe('plan_stored')
    expect(rz.plans.create).not.toHaveBeenCalled()
  })

  it('makes test plans weekly under BILLING_TEST_PERIOD=weekly, never live ones', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_w' })
    process.env.BILLING_TEST_PERIOD = 'weekly'
    const mod = await import('@controller/lib/payments/razorpay-subscriptions')
    await mod.ensureCombinedPlan('monthly', 20000)
    expect(rz.plans.create.mock.calls[0][0].period).toBe('weekly')
    process.env.RAZORPAY_KEY_ID = 'rzp_live_abc'
    await mod.ensureCombinedPlan('monthly', 20000)
    expect(rz.plans.create.mock.calls[1][0].period).toBe('monthly')
  })

  it('rejects a non-positive amount', async () => {
    const { ensureCombinedPlan } = await import('@controller/lib/payments/razorpay-subscriptions')
    await expect(ensureCombinedPlan('monthly', 0)).rejects.toThrow(/positive/)
  })
})

describe('createBillingSubscription', () => {
  it('creates a subscription with the pre-debit notice and no start_at or add-ons by default', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_1' })
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_1', short_url: 'https://rzp.io/i/x' })
    const { createBillingSubscription } = await import('@controller/lib/payments/razorpay-subscriptions')
    const out = await createBillingSubscription(subOpts)
    expect(out).toEqual({ subscriptionId: 'sub_1', shortUrl: 'https://rzp.io/i/x', planId: 'plan_1' })
    const arg = rz.subscriptions.create.mock.calls[0][0]
    expect(arg).toMatchObject({ plan_id: 'plan_1', quantity: 1, customer_notify: 1, total_count: 120, notes: subOpts.notes })
    expect(arg.start_at).toBeUndefined()
    expect(arg.addons).toBeUndefined()
  })

  it('keeps the billing date with start_at and collects proration as a positive upfront add-on', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_1' })
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_2', short_url: '' })
    const { createBillingSubscription } = await import('@controller/lib/payments/razorpay-subscriptions')
    await createBillingSubscription({ ...subOpts, startAt: 1_900_000_000.7, upfrontPaise: 12345.4, upfrontLabel: 'Rest of cycle' })
    const arg = rz.subscriptions.create.mock.calls[0][0]
    expect(arg.start_at).toBe(1_900_000_000)
    expect(arg.addons).toEqual([{ item: { name: 'Rest of cycle', amount: 12345, currency: 'INR' } }])
  })

  it('caps a yearly subscription at ten cycles', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_y' })
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_y' })
    const { createBillingSubscription } = await import('@controller/lib/payments/razorpay-subscriptions')
    await createBillingSubscription({ ...subOpts, interval: 'yearly', amountPaise: 2999000 })
    expect(rz.subscriptions.create.mock.calls[0][0].total_count).toBe(10)
  })
})

describe('one-time add-ons, refunds and invoices', () => {
  it('adds a one-time add-on to a subscription', async () => {
    rz.subscriptions.createAddon.mockResolvedValue({ id: 'ao_1' })
    const { addSubscriptionAddon } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(await addSubscriptionAddon('sub_1', { name: 'Domain renewal', amountPaise: 99900.2 })).toBe('ao_1')
    expect(rz.subscriptions.createAddon).toHaveBeenCalledWith('sub_1', {
      item: { name: 'Domain renewal', amount: 99900, currency: 'INR', description: 'Domain renewal' },
      quantity: 1,
    })
  })

  it('reads whether an add-on was billed, null when unknown', async () => {
    rz.addons.fetch.mockResolvedValueOnce({ id: 'ao_1', invoice_id: 'inv_1' }).mockRejectedValueOnce(new Error('404'))
    const { fetchAddon } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(await fetchAddon('ao_1')).toEqual({ id: 'ao_1', invoice_id: 'inv_1' })
    expect(await fetchAddon('ao_2')).toBeNull()
  })

  it('refunds part of a payment', async () => {
    rz.payments.refund.mockResolvedValue({ id: 'rfnd_1' })
    const { refundPayment } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(await refundPayment('pay_1', 20000, { reason: 'x' })).toBe('rfnd_1')
    expect(rz.payments.refund).toHaveBeenCalledWith('pay_1', { amount: 20000, speed: 'normal', notes: { reason: 'x' } })
  })

  it('lists a subscription invoices', async () => {
    rz.invoices.all.mockResolvedValue({ items: [{ id: 'inv_1', payment_id: 'pay_1', status: 'paid', amount_paid: 40000, paid_at: 1 }] })
    const { listSubscriptionInvoices } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(await listSubscriptionInvoices('sub_1')).toEqual([{ id: 'inv_1', payment_id: 'pay_1', status: 'paid', amount: 40000, paid_at: 1 }])
    expect(rz.invoices.all).toHaveBeenCalledWith({ subscription_id: 'sub_1', count: 10 })
  })
})

describe('cancelSubscription', () => {
  it('defaults to cancel-at-cycle-end', async () => {
    rz.subscriptions.cancel.mockResolvedValue({ status: 'active', current_end: 1700000000 })
    const { cancelSubscription } = await import('@controller/lib/payments/razorpay-subscriptions')
    const out = await cancelSubscription('sub_1')
    expect(rz.subscriptions.cancel).toHaveBeenCalledWith('sub_1', { cancel_at_cycle_end: 1 })
    expect(out).toEqual({ status: 'active', endsAt: 1700000000 })
  })

  it('cancels immediately when cancelAtCycleEnd:false', async () => {
    rz.subscriptions.cancel.mockResolvedValue({ status: 'cancelled', ended_at: 1699999999 })
    const { cancelSubscription } = await import('@controller/lib/payments/razorpay-subscriptions')
    const out = await cancelSubscription('sub_1', { cancelAtCycleEnd: false })
    expect(rz.subscriptions.cancel).toHaveBeenCalledWith('sub_1', { cancel_at_cycle_end: 0 })
    expect(out).toEqual({ status: 'cancelled', endsAt: 1699999999 })
  })

  it('falls back to cancelled status + null endsAt when Razorpay returns nothing useful', async () => {
    rz.subscriptions.cancel.mockResolvedValue({})
    const { cancelSubscription } = await import('@controller/lib/payments/razorpay-subscriptions')
    const out = await cancelSubscription('sub_1')
    expect(out).toEqual({ status: 'cancelled', endsAt: null })
  })
})

describe('getSubscription', () => {
  it('proxies to rz.subscriptions.fetch', async () => {
    rz.subscriptions.fetch.mockResolvedValue({ id: 'sub_1', status: 'active' })
    const { getSubscription } = await import('@controller/lib/payments/razorpay-subscriptions')
    const out = await getSubscription('sub_1')
    expect(out).toEqual({ id: 'sub_1', status: 'active' })
    expect(rz.subscriptions.fetch).toHaveBeenCalledWith('sub_1')
  })
})

describe('verifyWebhookSignature', () => {
  const SECRET = 'test-webhook-secret'

  it('accepts a correctly-signed body', async () => {
    const body = '{"event":"subscription.charged"}'
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    const { verifyWebhookSignature } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(() => verifyWebhookSignature(body, sig)).not.toThrow()
  })

  it('rejects a tampered body', async () => {
    const sig = crypto.createHmac('sha256', SECRET).update('a').digest('hex')
    const { verifyWebhookSignature } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(() => verifyWebhookSignature('b', sig)).toThrow(/signature mismatch/i)
  })

  it('throws when RAZORPAY_WEBHOOK_SECRET is unset', async () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    const { verifyWebhookSignature } = await import('@controller/lib/payments/razorpay-subscriptions')
    expect(() => verifyWebhookSignature('x', 'y')).toThrow(/RAZORPAY_WEBHOOK_SECRET is not set/)
    process.env.RAZORPAY_WEBHOOK_SECRET = saved
  })
})
