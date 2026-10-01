import { getRazorpayInstance } from '@/lib/payments/razorpay'

export type BillingInterval = 'monthly' | 'yearly'

// Monthly prices in paise (INR × 100) — must match plans.monthly_price_inr in the DB.
const MONTHLY_PAISE: Record<string, number> = {
  basic: 499900, // ₹4999
  growth: 999900, // ₹9999
  pro: 1999900, // ₹19999
  enterprise: 4999900, // ₹49999
}

// Yearly = monthly × 12 (full price — 20% discount applied via Razorpay offer at checkout).
function yearlyPaise(slug: string): number {
  return (MONTHLY_PAISE[slug] ?? 0) * 12
}

function planPaise(slug: string, interval: BillingInterval): number {
  return interval === 'yearly' ? yearlyPaise(slug) : (MONTHLY_PAISE[slug] ?? 0)
}

// In-process cache: "slug:interval" → Razorpay plan_id.
// Populated from env vars on first access; falls back to creating via API.
const planIdCache = new Map<string, string>()

function envPlanId(slug: string, interval: BillingInterval): string | undefined {
  const key = `RAZORPAY_PLAN_ID_${slug.toUpperCase()}_${interval.toUpperCase()}`
  return process.env[key] || undefined
}

async function ensureRazorpayPlan(slug: string, displayName: string, interval: BillingInterval): Promise<string> {
  const cacheKey = `${slug}:${interval}`
  const cached = planIdCache.get(cacheKey)
  if (cached) return cached

  // Prefer pinned env var to avoid duplicate plan creation across restarts.
  const pinned = envPlanId(slug, interval)
  if (pinned) {
    planIdCache.set(cacheKey, pinned)
    return pinned
  }

  const rz = getRazorpayInstance()
  const amount = planPaise(slug, interval)
  if (!amount) throw new Error(`Unknown plan slug: ${slug}`)

  const intervalLabel = interval === 'yearly' ? 'Yearly' : 'Monthly'
  const plan = await (rz.plans as any).create({
    period: interval === 'yearly' ? 'yearly' : 'monthly',
    interval: 1,
    item: {
      name: `Jeffi Commerce — ${displayName} (${intervalLabel})`,
      amount,
      unit_amount: amount,
      currency: 'INR',
      description: `${intervalLabel} subscription for the ${displayName} plan`,
    },
    notes: { plan_slug: slug, billing_interval: interval },
  })

  planIdCache.set(cacheKey, plan.id)
  return plan.id as string
}

export interface SubscriptionResult {
  subscriptionId: string
  shortUrl: string
}

/**
 * Create a Razorpay Subscription for a given plan + owner.
 * Returns the subscription id and Razorpay's hosted short_url for redirect.
 */
export async function createRazorpaySubscription(opts: {
  planSlug: string
  planName: string
  interval: BillingInterval
  ownerEmail: string
  ownerName: string | null
  tenantId: string
  tenantSlug: string
  callbackUrl: string
}): Promise<SubscriptionResult> {
  const rz = getRazorpayInstance()
  const planId = await ensureRazorpayPlan(opts.planSlug, opts.planName, opts.interval)

  const sub = await (rz.subscriptions as any).create({
    plan_id: planId,
    total_count: 120, // max cycles (10 yrs monthly / ~8 yrs yearly); Razorpay requires ≥1
    quantity: 1,
    customer_notify: 1,
    // For yearly plans, apply the 20% discount offer if configured.
    offer_id: opts.interval === 'yearly' ? process.env.RAZORPAY_YEARLY_OFFER_ID || null : null,
    notes: {
      tenant_id: opts.tenantId,
      tenant_slug: opts.tenantSlug,
      billing_interval: opts.interval,
    },
    notify_info: {
      notify_phone: '',
      notify_email: opts.ownerEmail,
    },
  })

  return {
    subscriptionId: sub.id as string,
    shortUrl: (sub.short_url ?? '') as string,
  }
}

/**
 * Upgrade: cancel the old subscription immediately, create a new one on the
 * higher plan. Razorpay has no native proration — we calculate the unused days
 * on the old cycle and add an addon credit on the new subscription.
 *
 * Returns the new subscription result.
 */
export async function upgradeSubscription(opts: {
  oldSubscriptionId: string
  newPlanSlug: string
  newPlanName: string
  newInterval: BillingInterval
  ownerEmail: string
  ownerName: string | null
  tenantId: string
  tenantSlug: string
  callbackUrl: string
}): Promise<SubscriptionResult & { proratedCreditPaise: number }> {
  const rz = getRazorpayInstance()

  // Fetch old sub to calculate proration.
  const oldSub = await (rz.subscriptions as any).fetch(opts.oldSubscriptionId)
  const nowSec = Math.floor(Date.now() / 1000)
  const cycleEnd: number = oldSub.current_end ?? nowSec
  const cycleStart: number = oldSub.current_start ?? nowSec
  const cycleLenSec = Math.max(cycleEnd - cycleStart, 1)
  const remainingSec = Math.max(cycleEnd - nowSec, 0)
  const oldPlanPaise = oldSub.plan?.item?.amount ?? 0
  const proratedCreditPaise = Math.round((remainingSec / cycleLenSec) * oldPlanPaise)

  // Cancel old subscription immediately.
  await (rz.subscriptions as any).cancel(opts.oldSubscriptionId, { cancel_at_cycle_end: 0 })

  // Create new subscription (with prorated addon credit if meaningful).
  const planId = await ensureRazorpayPlan(opts.newPlanSlug, opts.newPlanName, opts.newInterval)
  const addons =
    proratedCreditPaise > 0
      ? [{ item: { name: 'Prorated credit from previous plan', amount: -proratedCreditPaise, currency: 'INR' } }]
      : []

  const sub = await (rz.subscriptions as any).create({
    plan_id: planId,
    total_count: 0,
    quantity: 1,
    customer_notify: 1,
    offer_id: opts.newInterval === 'yearly' ? process.env.RAZORPAY_YEARLY_OFFER_ID || null : null,
    addons,
    notes: {
      tenant_id: opts.tenantId,
      tenant_slug: opts.tenantSlug,
      billing_interval: opts.newInterval,
      upgraded_from: opts.oldSubscriptionId,
    },
    notify_info: { notify_phone: '', notify_email: opts.ownerEmail },
  })

  return {
    subscriptionId: sub.id as string,
    shortUrl: (sub.short_url ?? '') as string,
    proratedCreditPaise,
  }
}

/**
 * Downgrade: schedule the plan change at the end of the current billing cycle.
 * The customer keeps their current plan until renewal, then switches.
 * Returns the scheduled change details.
 */
export async function downgradeSubscription(opts: {
  subscriptionId: string
  newPlanSlug: string
  newPlanName: string
  newInterval: BillingInterval
}): Promise<{ scheduledAt: number }> {
  const rz = getRazorpayInstance()
  const newPlanId = await ensureRazorpayPlan(opts.newPlanSlug, opts.newPlanName, opts.newInterval)

  await (rz.subscriptions as any).update(opts.subscriptionId, {
    plan_id: newPlanId,
    schedule_change_at: 'cycle_end',
    quantity: 1,
  })

  // Fetch to return the cycle_end timestamp as the effective-at date.
  const sub = await (rz.subscriptions as any).fetch(opts.subscriptionId)
  return { scheduledAt: sub.current_end ?? 0 }
}

/**
 * Cancel a Razorpay subscription. By default cancels at the end of the current billing
 * cycle so the owner keeps their store for the period they already paid for; the resulting
 * `subscription.cancelled`/`completed` webhook is what actually deprovisions the tenant.
 * Pass { cancelAtCycleEnd: false } to cancel immediately.
 */
export async function cancelSubscription(
  subscriptionId: string,
  opts?: { cancelAtCycleEnd?: boolean }
): Promise<{ status: string; endsAt: number | null }> {
  const rz = getRazorpayInstance()
  const cancelAtCycleEnd = opts?.cancelAtCycleEnd !== false
  const sub = await (rz.subscriptions as any).cancel(subscriptionId, {
    cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0,
  })
  return {
    status: (sub?.status ?? 'cancelled') as string,
    endsAt: (sub?.current_end ?? sub?.ended_at ?? null) as number | null,
  }
}

/**
 * Fetch a Razorpay subscription by id — used to read current_end, status, etc.
 */
export async function getSubscription(subscriptionId: string): Promise<any> {
  const rz = getRazorpayInstance()
  return (rz.subscriptions as any).fetch(subscriptionId)
}

/**
 * Verify a Razorpay webhook signature.
 * Throws if the signature doesn't match.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): void {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set')
  const crypto = require('crypto') as typeof import('crypto')
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  if (expected !== signature) throw new Error('Webhook signature mismatch')
}

/** Monthly prices exported for UI display. */
export { MONTHLY_PAISE, yearlyPaise, planPaise }
