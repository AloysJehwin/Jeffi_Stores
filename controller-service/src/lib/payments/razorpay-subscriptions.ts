import { getRazorpayInstance } from '@/lib/payments/razorpay'
import { controlPlanePool } from '@/lib/tenant-registry'

// Razorpay calls for workspace billing (lib/billing). One combined plan per distinct cycle amount, so a workspace's
// whole total (plan + add-ons + sites) is one subscription and one mandate. Everything works on rzp_test_ keys.

export type BillingInterval = 'monthly' | 'yearly'
export type RazorpayMode = 'test' | 'live'

/** Paise for a monthly price: monthly = priceInrMonth, yearly = 10× monthly (2 free months baked in). */
export function subscriptionPaise(priceInrMonth: number, interval: BillingInterval): number {
  const paise = Math.round(priceInrMonth * 100)
  return interval === 'yearly' ? paise * 10 : paise
}

/** test for rzp_test_ keys, so a test plan id is never used with live keys (and the reverse). */
export function razorpayMode(env: Record<string, string | undefined> = process.env): RazorpayMode {
  return (env.RAZORPAY_KEY_ID ?? '').startsWith('rzp_test_') ? 'test' : 'live'
}

// BILLING_TEST_PERIOD=weekly makes staging plans weekly (Razorpay's shortest daily plan is 7 days); test mode only.
function planPeriod(interval: BillingInterval): { period: string; label: string } {
  if (razorpayMode() === 'test' && process.env.BILLING_TEST_PERIOD === 'weekly') return { period: 'weekly', label: 'Weekly (test)' }
  return interval === 'yearly' ? { period: 'yearly', label: 'Yearly' } : { period: 'monthly', label: 'Monthly' }
}

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

/** period is the plan's Razorpay period: the interval, or weekly under BILLING_TEST_PERIOD. */
export const combinedPlanKey = (mode: RazorpayMode, period: string, paise: number) => `combo:${mode}:${period}:${paise}`

/** The Razorpay plan for one cycle amount, cached in process and in platform_infra 'razorpay_plans'. */
export async function ensureCombinedPlan(interval: BillingInterval, paise: number): Promise<string> {
  if (!(paise > 0)) throw new Error(`Subscription amount must be positive (got ${paise})`)
  const { period, label } = planPeriod(interval)
  const key = combinedPlanKey(razorpayMode(), period, paise)
  const known = planIdCache.get(key) ?? (await storedPlanId(key))
  if (known) {
    planIdCache.set(key, known)
    return known
  }
  const rupees = (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const plan = await (getRazorpayInstance().plans as any).create({
    period,
    interval: 1,
    item: { name: `Jeffi Commerce, ${label} ₹${rupees}`, amount: paise, unit_amount: paise, currency: 'INR', description: `${label} Jeffi subscription` },
    notes: { billing: 'combined', billing_interval: interval, amount_paise: String(paise) },
  })
  planIdCache.set(key, plan.id)
  await storePlanId(key, plan.id)
  return plan.id as string
}

export interface CreatedSubscription {
  subscriptionId: string
  shortUrl: string
  planId: string
}

/**
 * A combined subscription. startAt (unix seconds) keeps the billing date when it replaces one; upfrontPaise is the
 * proration for the rest of the current cycle, the only amount Razorpay collects at authorisation then.
 */
export async function createBillingSubscription(opts: {
  interval: BillingInterval
  amountPaise: number
  startAt?: number | null
  upfrontPaise?: number
  upfrontLabel?: string
  ownerEmail: string
  notes: Record<string, string>
}): Promise<CreatedSubscription> {
  const planId = await ensureCombinedPlan(opts.interval, opts.amountPaise)
  const upfront = Math.round(opts.upfrontPaise ?? 0)
  const sub = await (getRazorpayInstance().subscriptions as any).create({
    plan_id: planId,
    total_count: opts.interval === 'yearly' ? 10 : 120, // Razorpay requires a count; ~10 years either way
    quantity: 1,
    customer_notify: 1, // Razorpay's 24-hour pre-debit notice
    ...(opts.startAt ? { start_at: Math.floor(opts.startAt) } : {}),
    ...(upfront > 0 ? { addons: [{ item: { name: opts.upfrontLabel ?? 'Rest of this billing cycle', amount: upfront, currency: 'INR' } }] } : {}),
    notes: opts.notes,
    notify_info: { notify_email: opts.ownerEmail },
  })
  return { subscriptionId: sub.id as string, shortUrl: (sub.short_url ?? '') as string, planId }
}

/** A one-time add-on charged with the subscription's next invoice (domain renewals). Returns the add-on id. */
export async function addSubscriptionAddon(subscriptionId: string, item: { name: string; amountPaise: number; description?: string }): Promise<string> {
  const rz: any = getRazorpayInstance()
  const addon = await rz.subscriptions.createAddon(subscriptionId, {
    item: { name: item.name, amount: Math.round(item.amountPaise), currency: 'INR', description: item.description ?? item.name },
    quantity: 1,
  })
  return addon.id as string
}

/** An add-on; invoice_id is set once a charge has billed it. */
export async function fetchAddon(addonId: string): Promise<{ id: string; invoice_id: string | null } | null> {
  const a = await (getRazorpayInstance() as any).addons.fetch(addonId).catch(() => null)
  return a ? { id: a.id, invoice_id: a.invoice_id ?? null } : null
}

export async function deleteAddon(addonId: string): Promise<void> {
  await (getRazorpayInstance() as any).addons.delete(addonId)
}

/** Part of a charge back to the payer (lines removed but still on an unapproved, higher mandate). */
export async function refundPayment(paymentId: string, amountPaise: number, notes: Record<string, string>): Promise<string> {
  const r = await (getRazorpayInstance().payments as any).refund(paymentId, { amount: Math.round(amountPaise), speed: 'normal', notes })
  return r.id as string
}

/** Paid invoices of a subscription (the sweep's catch-up for missed charge webhooks). */
export async function listSubscriptionInvoices(subscriptionId: string): Promise<{ id: string; payment_id: string | null; status: string; amount: number; paid_at: number | null }[]> {
  const r = await (getRazorpayInstance().invoices as any).all({ subscription_id: subscriptionId, count: 10 })
  return (r?.items ?? []).map((i: any) => ({ id: i.id, payment_id: i.payment_id ?? null, status: i.status, amount: Number(i.amount_paid ?? i.amount ?? 0), paid_at: i.paid_at ?? null }))
}

// Razorpay's answer to a cycle-end cancel before any cycle has started (seen in test mode on a created subscription).
const NO_CYCLE = /no billing cycle is going on/i

/**
 * Cancel a Razorpay subscription. At cycle end by default, so the workspace keeps the period it paid for; the
 * resulting cancelled/completed webhook ends its lines. With no cycle started yet nothing has been paid for, so a
 * cycle-end cancel that Razorpay refuses is made at once.
 */
export async function cancelSubscription(
  subscriptionId: string,
  opts?: { cancelAtCycleEnd?: boolean }
): Promise<{ status: string; endsAt: number | null }> {
  const cancelAtCycleEnd = opts?.cancelAtCycleEnd !== false
  const subs = getRazorpayInstance().subscriptions as any
  // The SDK takes a boolean (true sends cancel_at_cycle_end=1); an options object is truthy, so it always meant cycle end.
  let sub: any
  try {
    sub = await subs.cancel(subscriptionId, cancelAtCycleEnd)
  } catch (e: any) {
    if (!cancelAtCycleEnd || !NO_CYCLE.test(e?.error?.description ?? '')) throw e
    sub = await subs.cancel(subscriptionId, false)
  }
  return {
    status: (sub?.status ?? 'cancelled') as string,
    endsAt: (sub?.current_end ?? sub?.ended_at ?? null) as number | null,
  }
}

export async function getSubscription(subscriptionId: string): Promise<any> {
  return (getRazorpayInstance().subscriptions as any).fetch(subscriptionId)
}

/** Verify a Razorpay webhook signature. Throws if it doesn't match. */
export function verifyWebhookSignature(rawBody: string, signature: string): void {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set')
  const crypto = require('crypto') as typeof import('crypto')
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  if (expected !== signature) throw new Error('Webhook signature mismatch')
}
