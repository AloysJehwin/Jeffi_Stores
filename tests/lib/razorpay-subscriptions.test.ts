/**
 * Tests for src/lib/razorpay-subscriptions.ts — SaaS plan billing via Razorpay
 * Subscriptions (create / upgrade / downgrade / cancel / fetch) + webhook verify.
 *
 * The Razorpay SDK is mocked at ./razorpay's getRazorpayInstance(). The in-process
 * plan-id cache means once a (slug:interval) plan is created it is reused, so tests
 * either pin env plan ids or clear the module between assertions where the cache
 * would mask a branch.
 *
 * Pins: env-pinned vs API-created plan resolution, unknown-slug guard, yearly =
 * monthly×12, the offer_id gating, upgrade proration math, downgrade scheduling,
 * cancel-at-cycle-end default, and HMAC webhook verification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const rz = {
  plans: { create: vi.fn() },
  subscriptions: { create: vi.fn(), fetch: vi.fn(), cancel: vi.fn(), update: vi.fn() },
}
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: () => rz }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules() // reset the plan-id cache between tests
  // Clear any pinned plan-id env vars.
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('RAZORPAY_PLAN_ID_')) delete process.env[k]
  }
  delete process.env.RAZORPAY_YEARLY_OFFER_ID
})

const subOpts = {
  planSlug: 'basic',
  planName: 'Basic',
  interval: 'monthly' as const,
  ownerEmail: 'o@acme.in',
  ownerName: 'Owner',
  tenantId: 't-1',
  tenantSlug: 'acme',
  callbackUrl: 'https://acme.jeffistores.in/cb',
}

// ── createRazorpaySubscription ──────────────────────────────────────────────
describe('createRazorpaySubscription', () => {
  it('creates a plan via API then a subscription, returning id + short_url', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_api' })
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_1', short_url: 'https://rzp.io/s1' })
    const { createRazorpaySubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await createRazorpaySubscription(subOpts)
    expect(out).toEqual({ subscriptionId: 'sub_1', shortUrl: 'https://rzp.io/s1' })
    // plan created monthly with the basic monthly amount (₹4999 = 499900 paise)
    expect(rz.plans.create.mock.calls[0][0]).toMatchObject({ period: 'monthly', interval: 1 })
    expect(rz.plans.create.mock.calls[0][0].item.amount).toBe(499900)
    // no yearly offer on a monthly sub
    expect(rz.subscriptions.create.mock.calls[0][0].offer_id).toBeNull()
  })

  it('prefers a pinned env plan id and skips API plan creation', async () => {
    process.env.RAZORPAY_PLAN_ID_BASIC_MONTHLY = 'plan_pinned'
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_2', short_url: 'u' })
    const { createRazorpaySubscription } = await import('@/lib/payments/razorpay-subscriptions')
    await createRazorpaySubscription(subOpts)
    expect(rz.plans.create).not.toHaveBeenCalled()
    expect(rz.subscriptions.create.mock.calls[0][0].plan_id).toBe('plan_pinned')
  })

  it('applies the yearly offer id for a yearly subscription and uses monthly×12 pricing', async () => {
    process.env.RAZORPAY_YEARLY_OFFER_ID = 'offer_yr'
    rz.plans.create.mockResolvedValue({ id: 'plan_yr' })
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_yr', short_url: 'u' })
    const { createRazorpaySubscription } = await import('@/lib/payments/razorpay-subscriptions')
    await createRazorpaySubscription({ ...subOpts, interval: 'yearly' })
    expect(rz.plans.create.mock.calls[0][0].period).toBe('yearly')
    expect(rz.plans.create.mock.calls[0][0].item.amount).toBe(499900 * 12)
    expect(rz.subscriptions.create.mock.calls[0][0].offer_id).toBe('offer_yr')
  })

  it('yearly with no offer configured passes offer_id null', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_yr2' })
    rz.subscriptions.create.mockResolvedValue({ id: 's', short_url: 'u' })
    const { createRazorpaySubscription } = await import('@/lib/payments/razorpay-subscriptions')
    await createRazorpaySubscription({ ...subOpts, interval: 'yearly' })
    expect(rz.subscriptions.create.mock.calls[0][0].offer_id).toBeNull()
  })

  it('defaults short_url to empty string when Razorpay omits it', async () => {
    process.env.RAZORPAY_PLAN_ID_BASIC_MONTHLY = 'plan_pinned'
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_no_url' })
    const { createRazorpaySubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await createRazorpaySubscription(subOpts)
    expect(out.shortUrl).toBe('')
  })

  it('throws for an unknown plan slug (no pinned env, zero amount)', async () => {
    const { createRazorpaySubscription } = await import('@/lib/payments/razorpay-subscriptions')
    await expect(createRazorpaySubscription({ ...subOpts, planSlug: 'mystery' })).rejects.toThrow(
      /Unknown plan slug: mystery/
    )
    expect(rz.plans.create).not.toHaveBeenCalled()
  })

  it('reuses the in-process cache on a second call for the same slug:interval', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_cached' })
    rz.subscriptions.create.mockResolvedValue({ id: 's', short_url: 'u' })
    const { createRazorpaySubscription } = await import('@/lib/payments/razorpay-subscriptions')
    await createRazorpaySubscription(subOpts)
    await createRazorpaySubscription(subOpts)
    // plan created only once; second call hit the cache.
    expect(rz.plans.create).toHaveBeenCalledTimes(1)
  })
})

// ── upgradeSubscription — proration ─────────────────────────────────────────
describe('upgradeSubscription', () => {
  const upOpts = {
    oldSubscriptionId: 'sub_old',
    newPlanSlug: 'growth',
    newPlanName: 'Growth',
    newInterval: 'monthly' as const,
    ownerEmail: 'o@acme.in',
    ownerName: 'Owner',
    tenantId: 't-1',
    tenantSlug: 'acme',
    callbackUrl: 'u',
  }

  it('cancels the old sub, prorates the unused half-cycle into a negative addon', async () => {
    const now = Math.floor(Date.now() / 1000)
    // Half the cycle remains → half the ₹4999 (499900 paise) old plan = 249950 credit.
    rz.subscriptions.fetch.mockResolvedValue({
      current_start: now - 15 * 86400,
      current_end: now + 15 * 86400,
      plan: { item: { amount: 499900 } },
    })
    rz.subscriptions.cancel.mockResolvedValue({})
    rz.plans.create.mockResolvedValue({ id: 'plan_growth' })
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_new', short_url: 'u2' })
    const { upgradeSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await upgradeSubscription(upOpts)
    expect(rz.subscriptions.cancel).toHaveBeenCalledWith('sub_old', { cancel_at_cycle_end: 0 })
    expect(out.subscriptionId).toBe('sub_new')
    // ~half of 499900 → allow rounding slack
    expect(out.proratedCreditPaise).toBeGreaterThan(240000)
    expect(out.proratedCreditPaise).toBeLessThan(260000)
    const created = rz.subscriptions.create.mock.calls[0][0]
    expect(created.addons[0].item.amount).toBe(-out.proratedCreditPaise)
    expect(created.notes.upgraded_from).toBe('sub_old')
  })

  it('adds no addon when there is no remaining credit (cycle already ended)', async () => {
    const now = Math.floor(Date.now() / 1000)
    rz.subscriptions.fetch.mockResolvedValue({
      current_start: now - 30 * 86400,
      current_end: now - 1,
      plan: { item: { amount: 499900 } },
    })
    rz.subscriptions.cancel.mockResolvedValue({})
    rz.plans.create.mockResolvedValue({ id: 'plan_growth' })
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_new2', short_url: 'u' })
    const { upgradeSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await upgradeSubscription(upOpts)
    expect(out.proratedCreditPaise).toBe(0)
    expect(rz.subscriptions.create.mock.calls[0][0].addons).toEqual([])
  })

  it('handles a missing old-plan amount / cycle fields gracefully (defaults to now)', async () => {
    rz.subscriptions.fetch.mockResolvedValue({}) // no current_start/end/plan
    rz.subscriptions.cancel.mockResolvedValue({})
    rz.plans.create.mockResolvedValue({ id: 'plan_growth' })
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_new3', short_url: 'u' })
    const { upgradeSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await upgradeSubscription(upOpts)
    expect(out.proratedCreditPaise).toBe(0)
  })

  it('applies the yearly offer id when upgrading to a yearly plan', async () => {
    process.env.RAZORPAY_YEARLY_OFFER_ID = 'offer_up_yr'
    const now = Math.floor(Date.now() / 1000)
    rz.subscriptions.fetch.mockResolvedValue({
      current_start: now - 10,
      current_end: now - 1,
      plan: { item: { amount: 0 } },
    })
    rz.subscriptions.cancel.mockResolvedValue({})
    rz.plans.create.mockResolvedValue({ id: 'plan_growth_yr' })
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_up_yr', short_url: 'u' })
    const { upgradeSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    await upgradeSubscription({ ...upOpts, newInterval: 'yearly' })
    expect(rz.subscriptions.create.mock.calls[0][0].offer_id).toBe('offer_up_yr')
  })
})

// ── downgradeSubscription ───────────────────────────────────────────────────
describe('downgradeSubscription', () => {
  it('schedules the plan change at cycle_end and returns the effective date', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_basic' })
    rz.subscriptions.update.mockResolvedValue({})
    rz.subscriptions.fetch.mockResolvedValue({ current_end: 1700000000 })
    const { downgradeSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await downgradeSubscription({
      subscriptionId: 'sub_1',
      newPlanSlug: 'basic',
      newPlanName: 'Basic',
      newInterval: 'monthly',
    })
    expect(rz.subscriptions.update).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({
        plan_id: 'plan_basic',
        schedule_change_at: 'cycle_end',
        quantity: 1,
      })
    )
    expect(out).toEqual({ scheduledAt: 1700000000 })
  })

  it('returns scheduledAt 0 when the fetched sub has no current_end', async () => {
    rz.plans.create.mockResolvedValue({ id: 'plan_basic' })
    rz.subscriptions.update.mockResolvedValue({})
    rz.subscriptions.fetch.mockResolvedValue({})
    const { downgradeSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await downgradeSubscription({
      subscriptionId: 'sub_1',
      newPlanSlug: 'basic',
      newPlanName: 'Basic',
      newInterval: 'monthly',
    })
    expect(out.scheduledAt).toBe(0)
  })
})

// ── cancelSubscription ──────────────────────────────────────────────────────
describe('cancelSubscription', () => {
  it('defaults to cancel-at-cycle-end (keeps the store for the paid period)', async () => {
    rz.subscriptions.cancel.mockResolvedValue({ status: 'active', current_end: 1700000000 })
    const { cancelSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await cancelSubscription('sub_1')
    expect(rz.subscriptions.cancel).toHaveBeenCalledWith('sub_1', { cancel_at_cycle_end: 1 })
    expect(out).toEqual({ status: 'active', endsAt: 1700000000 })
  })

  it('cancels immediately when cancelAtCycleEnd:false', async () => {
    rz.subscriptions.cancel.mockResolvedValue({ status: 'cancelled', ended_at: 1699999999 })
    const { cancelSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await cancelSubscription('sub_1', { cancelAtCycleEnd: false })
    expect(rz.subscriptions.cancel).toHaveBeenCalledWith('sub_1', { cancel_at_cycle_end: 0 })
    expect(out).toEqual({ status: 'cancelled', endsAt: 1699999999 })
  })

  it('falls back to cancelled status + null endsAt when Razorpay returns nothing useful', async () => {
    rz.subscriptions.cancel.mockResolvedValue({})
    const { cancelSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await cancelSubscription('sub_1')
    expect(out).toEqual({ status: 'cancelled', endsAt: null })
  })
})

// ── getSubscription ─────────────────────────────────────────────────────────
describe('getSubscription', () => {
  it('proxies to rz.subscriptions.fetch', async () => {
    rz.subscriptions.fetch.mockResolvedValue({ id: 'sub_1', status: 'active' })
    const { getSubscription } = await import('@/lib/payments/razorpay-subscriptions')
    const out = await getSubscription('sub_1')
    expect(out).toEqual({ id: 'sub_1', status: 'active' })
    expect(rz.subscriptions.fetch).toHaveBeenCalledWith('sub_1')
  })
})

// ── verifyWebhookSignature ──────────────────────────────────────────────────
describe('verifyWebhookSignature', () => {
  const SECRET = 'test-webhook-secret' // matches vitest.config env

  it('accepts a correctly-signed body', async () => {
    const body = '{"event":"subscription.charged"}'
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    const { verifyWebhookSignature } = await import('@/lib/payments/razorpay-subscriptions')
    expect(() => verifyWebhookSignature(body, sig)).not.toThrow()
  })

  it('rejects a tampered body', async () => {
    const sig = crypto.createHmac('sha256', SECRET).update('a').digest('hex')
    const { verifyWebhookSignature } = await import('@/lib/payments/razorpay-subscriptions')
    expect(() => verifyWebhookSignature('b', sig)).toThrow(/signature mismatch/i)
  })

  it('throws when RAZORPAY_WEBHOOK_SECRET is unset', async () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    const { verifyWebhookSignature } = await import('@/lib/payments/razorpay-subscriptions')
    expect(() => verifyWebhookSignature('x', 'y')).toThrow(/RAZORPAY_WEBHOOK_SECRET is not set/)
    process.env.RAZORPAY_WEBHOOK_SECRET = saved
  })
})

// ── exported price helpers ──────────────────────────────────────────────────
describe('price helpers', () => {
  it('yearlyPaise = monthly × 12; planPaise switches on interval', async () => {
    const { yearlyPaise, planPaise, MONTHLY_PAISE } = await import('@/lib/payments/razorpay-subscriptions')
    expect(yearlyPaise('growth')).toBe(MONTHLY_PAISE.growth * 12)
    expect(planPaise('pro', 'monthly')).toBe(MONTHLY_PAISE.pro)
    expect(planPaise('pro', 'yearly')).toBe(MONTHLY_PAISE.pro * 12)
    expect(yearlyPaise('nope')).toBe(0)
  })
})
