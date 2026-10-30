import { getRazorpayInstance } from '@/lib/payments/razorpay'
import { controlPlanePool } from '@/lib/tenant-registry'

export type BillingInterval = 'monthly' | 'yearly'

/** The plan's fee in paise, from plans.monthly_price_inr (GST included); yearly is ten months (two free). */
export async function planPaise(slug: string, interval: BillingInterval): Promise<number> {
  const r = await controlPlanePool().query<{ monthly_price_inr: string }>(`SELECT monthly_price_inr FROM plans WHERE slug = $1`, [slug])
  const monthly = Math.round(Number(r.rows[0]?.monthly_price_inr ?? 0) * 100)
  return interval === 'yearly' ? monthly * 10 : monthly
}

// Razorpay plans by "slug:interval:paise", so a fee change gets a new Razorpay plan: in process, and in
// platform_infra 'razorpay_plans' so a restart doesn't create another.
const planIdCache = new Map<string, string>()
const STORED = 'razorpay_plans'

async function storedPlanId(key: string): Promise<string | undefined> {
  const r = await controlPlanePool().query<{ value: string }>(`SELECT value FROM platform_infra WHERE key = $1`, [STORED])
  try {
    return JSON.parse(r.rows[0]?.value ?? '{}')[key] || undefined
  } catch {
    return undefined
  }
}

async function storePlanId(key: string, id: string): Promise<void> {
  await controlPlanePool().query(
    `INSERT INTO platform_infra (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = (COALESCE(platform_infra.value, '{}')::jsonb || $2::jsonb)::text, updated_at = now()`,
    [STORED, JSON.stringify({ [key]: id })]
  )
}

// A plan pinned in env (RAZORPAY_PLAN_ID_<SLUG>_<INTERVAL>) is used only while it still charges the DB's fee.
async function pinnedPlanId(slug: string, interval: BillingInterval, amount: number): Promise<string | undefined> {
  const id = process.env[`RAZORPAY_PLAN_ID_${slug.toUpperCase()}_${interval.toUpperCase()}`]
  if (!id) return undefined
  const plan = await (getRazorpayInstance().plans as any).fetch(id).catch(() => null)
  return plan?.item?.amount === amount ? id : undefined
}

async function ensureRazorpayPlan(slug: string, displayName: string, interval: BillingInterval): Promise<string> {
  const amount = await planPaise(slug, interval)
  if (!amount) throw new Error(`Unknown plan slug: ${slug}`)
  const cacheKey = `${slug}:${interval}:${amount}`
  const known = planIdCache.get(cacheKey) ?? (await storedPlanId(cacheKey)) ?? (await pinnedPlanId(slug, interval, amount))
  if (known) {
    planIdCache.set(cacheKey, known)
    return known
  }

  const intervalLabel = interval === 'yearly' ? 'Yearly' : 'Monthly'
  const plan = await (getRazorpayInstance().plans as any).create({
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
  await storePlanId(cacheKey, plan.id)
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
 * Upgrade: a new subscription on the higher plan, with the unused days of the old cycle as a credit
 * addon (Razorpay has no native proration). The caller saves the new id, then cancelOldSubscription.
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

  // The new subscription first: the old one is cancelled only once the caller has saved the new id
  // (cancelOldSubscription), so the old one's cancellation webhook finds a superseded id and is ignored.
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

/** After an upgrade's new subscription id is saved: end the old one now. */
export async function cancelOldSubscription(oldSubscriptionId: string): Promise<void> {
  await (getRazorpayInstance().subscriptions as any).cancel(oldSubscriptionId, { cancel_at_cycle_end: 0 })
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
