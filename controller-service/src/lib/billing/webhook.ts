import 'server-only'
import { applyPendingPlan, controlPlanePool, setPendingPlan, setSubscriptionStatus, updateTenantPlan } from '@/lib/tenant-registry'
import { invalidatePlanCache } from '@/lib/auth/plan-gate'
import { issuePlatformInvoiceLater } from '@/lib/billing/platform-invoice'
import { cancelSubscription, getSubscription, refundPayment } from '@controller/lib/payments/razorpay-subscriptions'
import { triggerProvisioning } from '@controller/lib/provisioning/trigger'
import { startStoreIfReady } from '@controller/lib/provisioning/start-store'
import { saveDesiredCompute } from '@controller/lib/compute/store'
import type { ComputeSpec } from '@/lib/compute/spec'
import { chargedAt, cyclePaise, DAY_MS, listLines, monthlyTotal, patchLine, toLine, type BillingLine } from './lines'
import { getBillingSubscription, subscriptionByRazorpayId, type BillingSubscription } from './subscription'
import { extendEntitlements } from './entitlements'
import { applyMigrationCredits } from './migrate'
import { notifyBilling } from './notify'
import { closeEndedLines, closeStore } from './sweep'

// Billing subscription events from the platform Razorpay webhook (razorpay-events/dispatch.ts routes index rows
// with collecting_account 'billing' here). Takes over the old /api/ecom/webhook/razorpay: first-charge provisioning,
// applyPendingPlan, invoices. Idempotent: a charge is recorded once (billing_charges.razorpay_payment_id), and an
// event older than the last one handled doesn't move the status back.

export const GRACE_DAYS = 7
const ENDED = ['cancelled', 'completed', 'expired']
/** Replaced or never authorised: its events no longer move the workspace. */
const GONE = ['superseded', 'abandoned']

export interface BillingEventContext {
  tenantId: string
  eventId?: string | null
}

const sec = (v: unknown) => (typeof v === 'number' && v > 0 ? new Date(v * 1000) : null)

export async function onBillingSubscription(type: string, event: any, ctx: BillingEventContext): Promise<void> {
  const entity = event?.payload?.subscription?.entity
  const payment = event?.payload?.payment?.entity
  if (!entity?.id) return
  const sub = await subscriptionByRazorpayId(String(entity.id))
  if (!sub) {
    console.info('[billing:webhook] unknown billing subscription, ack-and-drop', { type, subId: entity.id, eventId: ctx.eventId })
    return
  }
  if (sub.tenantId !== ctx.tenantId) {
    console.warn('[billing:webhook] tenant mismatch, dropped', { subId: entity.id, eventId: ctx.eventId })
    return
  }
  const eventAt = sec(event?.created_at) ?? new Date()
  const stale = !!sub.lastEventAt && eventAt.getTime() < Date.parse(sub.lastEventAt)
  await recordCycle(sub, entity, eventAt)

  switch (type) {
    case 'subscription.authenticated':
      if (!stale && sub.status === 'created') await setStatus(sub, 'authenticated')
      await recordUpfront(sub, payment)
      if (sub.isCurrent) await mirrorAuthenticated(sub)
      else await takeEffect((await getBillingSubscription(sub.id))!)
      return
    case 'subscription.activated':
      if (!stale && !ENDED.includes(sub.status) && !GONE.includes(sub.status)) await setStatus(sub, 'active')
      return
    case 'subscription.charged':
      return onCharged(sub, entity, payment)
    case 'subscription.pending':
      if (stale || GONE.includes(sub.status)) return
      await setStatus(sub, 'pending')
      await notifyBilling(sub.tenantId, { kind: 'payment_pending', amountInr: sub.amountPaise / 100, payUrl: entity.short_url ?? sub.checkoutUrl }).catch(() => {})
      return
    case 'subscription.halted':
      if (stale || GONE.includes(sub.status)) return
      return onHalted(sub)
    case 'subscription.resumed':
      if (stale || GONE.includes(sub.status)) return
      return onResumed(sub)
    case 'subscription.paused':
      if (!stale && !GONE.includes(sub.status)) await setStatus(sub, 'paused')
      return
    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.expired':
      return onEnded(sub, type.slice('subscription.'.length), entity)
  }
}

async function setStatus(sub: BillingSubscription, status: string, extra = ''): Promise<void> {
  await controlPlanePool().query(`UPDATE billing_subscriptions SET status = $2${extra}, updated_at = now() WHERE id = $1`, [sub.id, status])
}

/** The tenant row mirrors a store's subscription (onboarding reads it). */
async function mirrorAuthenticated(sub: BillingSubscription): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenants SET subscription_status = 'authenticated', updated_at = now() WHERE id = $1 AND razorpay_subscription_id = $2 AND subscription_status = 'created'`,
    [sub.tenantId, sub.razorpaySubscriptionId]
  )
}

/** Cycle dates, payment method and the event time, from any event; dates only move forward. */
async function recordCycle(sub: BillingSubscription, entity: any, eventAt: Date): Promise<void> {
  await controlPlanePool().query(
    `UPDATE billing_subscriptions SET
        current_start = CASE WHEN $2::timestamptz IS NOT NULL AND (current_start IS NULL OR $2::timestamptz > current_start) THEN $2::timestamptz ELSE current_start END,
        current_end = CASE WHEN $3::timestamptz IS NOT NULL AND (current_end IS NULL OR $3::timestamptz > current_end) THEN $3::timestamptz ELSE current_end END,
        payment_method = COALESCE($4, payment_method),
        last_event_at = GREATEST(COALESCE(last_event_at, $5::timestamptz), $5::timestamptz),
        updated_at = now()
      WHERE id = $1`,
    [sub.id, sec(entity.current_start)?.toISOString() ?? null, sec(entity.current_end)?.toISOString() ?? null, entity.payment_method ?? null, eventAt.toISOString()]
  )
}

const hasStore = (lines: readonly BillingLine[]) => lines.some(l => l.kind === 'store_plan')

/**
 * A replacement the owner just authorised becomes the workspace's subscription: the one it replaces is superseded and
 * cancelled (at cycle end; at once for Pay now), its new lines start, raised prices and a store plan move apply, and
 * migrated lines get their wallet credit. True when this call made it current.
 */
export async function takeEffect(sub: BillingSubscription): Promise<boolean> {
  if (sub.isCurrent || [...GONE, ...ENDED].includes(sub.status)) return false
  const pool = controlPlanePool()
  const client = await pool.connect()
  let old: BillingSubscription | null = null
  let started: BillingLine[] = []
  try {
    await client.query('BEGIN')
    await client.query(`SELECT id FROM billing_subscriptions WHERE tenant_id = $1 FOR UPDATE`, [sub.tenantId])
    const fresh = (await getBillingSubscription(sub.id, client))!
    if (fresh.isCurrent) {
      await client.query('ROLLBACK')
      return false
    }
    const cur = await client.query(`SELECT id FROM billing_subscriptions WHERE tenant_id = $1 AND is_current`, [sub.tenantId])
    const replacedId = sub.replacesId ?? cur.rows[0]?.id ?? null
    old = replacedId ? await getBillingSubscription(replacedId, client) : null
    await client.query(
      `UPDATE billing_subscriptions SET is_current = false,
              status = CASE WHEN status IN ('cancelled','completed','expired','abandoned') THEN status ELSE 'superseded' END, updated_at = now()
        WHERE tenant_id = $1 AND is_current`,
      [sub.tenantId]
    )
    await client.query(`UPDATE billing_subscriptions SET is_current = true, grace_until = NULL, updated_at = now() WHERE id = $1`, [sub.id])
    // Trials and waiting lines the old one covered are this one's now (it charges for them).
    if (old) {
      await client.query(
        `UPDATE billing_lines SET subscription_id = $2, updated_at = now() WHERE subscription_id = $1 AND status IN ('trial','awaiting_payment')`,
        [old.id, sub.id]
      )
    }
    for (const a of sub.pendingChange?.amounts ?? []) {
      await client.query(
        `UPDATE billing_lines SET amount_paise = $4, next_amount_paise = NULL, changes_at = NULL, updated_at = now()
          WHERE tenant_id = $1 AND kind = $2 AND ref = $3 AND status <> 'ended'`,
        [sub.tenantId, a.kind, a.ref, a.amountPaise]
      )
    }
    // A Pay now replacement charges at once: its lines start on the charge.
    if (!sub.pendingChange?.replaceNow && old) {
      const r = await client.query(
        `UPDATE billing_lines SET status = 'active', grace_until = NULL, updated_at = now()
          WHERE subscription_id = $1 AND status = 'awaiting_payment' RETURNING *`,
        [sub.id]
      )
      started = r.rows.map(toLine)
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }

  if (old && !ENDED.includes(old.status)) {
    await cancelSubscription(old.razorpaySubscriptionId, { cancelAtCycleEnd: !sub.pendingChange?.replaceNow }).catch(e =>
      console.error(`[billing:webhook] ${old!.razorpaySubscriptionId} not cancelled (still charging): ${e?.message || e}`)
    )
  }
  // The upfront add-on paid for the rest of the old cycle.
  const paidThrough = old?.currentEnd ?? sub.startAt
  if (started.length && paidThrough) await extendEntitlements(sub.tenantId, started, new Date(Date.parse(paidThrough) + DAY_MS))
  if (started.length) await applyMigrationCredits(started).catch(e => console.error('[billing:webhook] migration credit failed', e?.message || e))

  const lines = await listLines(sub.tenantId)
  if (hasStore(lines)) {
    await pool.query(
      `UPDATE tenants SET razorpay_subscription_id = $2, subscription_status = CASE WHEN subscription_status = 'active' THEN 'active' ELSE 'authenticated' END,
              razorpay_checkout_url = NULL, billing_interval = $3, updated_at = now() WHERE id = $1`,
      [sub.tenantId, sub.razorpaySubscriptionId, sub.interval]
    )
  }
  await applyStorePlanMove(sub)
  return true
}

async function applyStorePlanMove(sub: BillingSubscription): Promise<void> {
  const change = sub.pendingChange
  if (!change?.plan && !change?.spec) return
  const t = (await controlPlanePool().query<{ slug: string; plan: string | null }>(
    `SELECT t.slug, p.slug AS plan FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`,
    [sub.tenantId]
  )).rows[0]
  if (!t) return
  if (change.plan) {
    await updateTenantPlan(sub.tenantId, { planSlug: change.plan.slug, billingInterval: change.plan.interval })
    await setPendingPlan(sub.tenantId, null)
    invalidatePlanCache(sub.tenantId)
  }
  if (change.spec) await saveDesiredCompute(sub.tenantId, change.spec as ComputeSpec, change.applyMode ?? 'window')
  if (change.plan && change.plan.slug !== t.plan) {
    await triggerProvisioning({ action: 'reprovision', tenantId: sub.tenantId, slug: t.slug, plan: change.plan.slug, ownerId: change.ownerId ?? null, reason: 'plan_change' }).catch(() => {})
  }
}

async function insertCharge(sub: BillingSubscription, payment: any, start: Date | null, end: Date | null): Promise<string | null> {
  const ins = await controlPlanePool().query(
    `INSERT INTO billing_charges (tenant_id, subscription_id, razorpay_payment_id, razorpay_invoice_id, amount_paise, lines, period_start, period_end)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) ON CONFLICT (razorpay_payment_id) DO NOTHING RETURNING id`,
    [sub.tenantId, sub.id, payment.id, payment.invoice_id ?? null, Number(payment.amount) || 0, JSON.stringify(sub.lines), start?.toISOString() ?? null, end?.toISOString() ?? null]
  )
  return (ins.rows[0]?.id as string | undefined) ?? null
}

/** The upfront proration a replacement collects at authorisation: recorded and invoiced like a charge. */
async function recordUpfront(sub: BillingSubscription, payment: any): Promise<void> {
  if (!(sub.upfrontPaise > 0) || !payment?.id || !(Number(payment.amount) >= sub.upfrontPaise)) return
  const id = await insertCharge(sub, payment, new Date(), sub.startAt ? new Date(sub.startAt) : null)
  if (id) await invoiceCharge(sub, payment, [], null, null, 'rest of this billing cycle')
}

/** When a charge's paid period ends: from the event, else Razorpay, else one interval from now. */
async function periodEndOf(sub: BillingSubscription, entity: any): Promise<number> {
  const fromEvent = sec(entity?.current_end)
  if (fromEvent && fromEvent.getTime() > Date.now()) return fromEvent.getTime()
  const rz = await getSubscription(sub.razorpaySubscriptionId).catch(() => null)
  const fetched = sec(rz?.current_end)
  if (fetched && fetched.getTime() > Date.now()) return fetched.getTime()
  return Date.now() + (sub.interval === 'yearly' ? 365 : 31) * DAY_MS
}

async function onCharged(sub: BillingSubscription, entity: any, payment: any): Promise<void> {
  const pool = controlPlanePool()
  // A replaced (or abandoned) subscription charged anyway: its replacement pays for this period, so all of it goes back.
  if (GONE.includes(sub.status)) {
    if (!payment?.id) return
    const id = await insertCharge(sub, payment, sec(entity.current_start), sec(entity.current_end))
    if (!id) return
    console.warn(`[billing:webhook] ${sub.status} ${sub.razorpaySubscriptionId} charged ${payment.id}: refunding in full`)
    await cancelSubscription(sub.razorpaySubscriptionId, { cancelAtCycleEnd: false }).catch(() => {})
    const amount = Number(payment.amount) || 0
    if (amount > 0) {
      await refundPayment(payment.id, amount, { reason: `billing_${sub.status}`, billing_subscription_id: sub.id })
      await pool.query(`UPDATE billing_charges SET refunded_paise = $2 WHERE id = $1`, [id, amount])
    }
    return
  }
  if (!sub.isCurrent && sub.replacesId) await takeEffect(sub)
  else if (!sub.isCurrent && !ENDED.includes(sub.status)) {
    // A first checkout paid after it stopped being current: it becomes current unless another one is paying.
    const cur = await pool.query(`SELECT 1 FROM billing_subscriptions WHERE tenant_id = $1 AND is_current AND status IN ('authenticated','active','pending')`, [sub.tenantId])
    if (!cur.rowCount) await takeEffect({ ...sub, status: 'created' })
  }
  if (!ENDED.includes(sub.status)) await setStatus(sub, 'active', ', grace_until = NULL')
  if (!payment?.id) return

  const periodStart = sec(entity.current_start)
  const periodEnd = sec(entity.current_end)
  const chargeId = await insertCharge(sub, payment, periodStart, periodEnd)
  if (!chargeId) return

  // Lines whose end or lower price has come, then everything this subscription charges for that hadn't started
  // (waiting lines, and chosen trials: the amount includes them from the first charge).
  await closeEndedLines(sub.tenantId)
  let lines = await listLines(sub.tenantId)
  const starting = lines.filter(l => l.subscriptionId === sub.id && (l.status === 'awaiting_payment' || l.status === 'trial'))
  for (const l of starting) await patchLine(l.id, { status: 'active', grace_until: null })
  await pool.query(`UPDATE billing_lines SET grace_until = NULL, updated_at = now() WHERE tenant_id = $1 AND grace_until IS NOT NULL AND status IN ('active','ending')`, [sub.tenantId])
  if (starting.length) await applyMigrationCredits(starting).catch(e => console.error('[billing:webhook] migration credit failed', e?.message || e))
  lines = await listLines(sub.tenantId)

  const now = Date.now()
  const until = new Date((await periodEndOf(sub, entity)) + DAY_MS)
  const resumed = await extendEntitlements(sub.tenantId, lines.filter(l => paidHere(l, now)), until)
  if (resumed.length) {
    const { notifyShowcaseResumed } = await import('@controller/lib/showcase/billing')
    for (const id of resumed) await notifyShowcaseResumed(id).catch(() => {})
  }

  if (hasStore(lines)) await storeCharged(sub.tenantId)
  await invoiceCharge(sub, payment, lines, periodStart, periodEnd)
  await refundRemoved(sub, payment, lines, chargeId).catch(e => console.error(`[billing:webhook] refund for ${payment.id} failed: ${e?.message || e}`))
  const { markDomainAddonsPaid } = await import('@controller/lib/domains/renewal')
  await markDomainAddonsPaid(sub.tenantId, payment.id).catch(e => console.error('[billing:webhook] domain renewals not checked', e?.message || e))
}

/** Lines a charge at `at` pays for: running ones (an ending one until its end), not ones still waiting or in a trial. */
const paidHere = (l: BillingLine, at: number) => chargedAt(l, at) && l.status !== 'awaiting_payment' && l.status !== 'trial'

/** The store side of a charge: the first one starts the build, a halted store comes back, a waiting downgrade applies. */
async function storeCharged(tenantId: string): Promise<void> {
  const t = (await controlPlanePool().query<{ slug: string; status: string; store_request: string | null; subscription_status: string | null }>(
    `SELECT slug, status, store_request, subscription_status FROM tenants WHERE id = $1`,
    [tenantId]
  )).rows[0]
  if (!t) return
  if (t.status === 'suspended' && t.subscription_status === 'halted') {
    await setSubscriptionStatus(tenantId, 'active', 'active')
    return
  }
  if (t.store_request === 'awaiting_payment' || (!t.store_request && t.status !== 'active' && t.status !== 'provisioning')) {
    await setSubscriptionStatus(tenantId, 'active')
    await startStoreIfReady(tenantId)
    return
  }
  await setSubscriptionStatus(tenantId, 'active')
  const moved = await applyPendingPlan(tenantId)
  if (moved) {
    invalidatePlanCache(tenantId)
    await triggerProvisioning({ action: 'reprovision', tenantId, slug: t.slug, plan: moved, ownerId: null, reason: 'plan_change' }).catch(() => {})
  }
}

// Tax invoice and the settlement_ledger row for every charge. Prices include GST (decision 5).
async function invoiceCharge(sub: BillingSubscription, payment: any, lines: readonly BillingLine[], start: Date | null, end: Date | null, note?: string): Promise<void> {
  if (!(Number(payment.amount) > 0)) return
  const d = (x: Date | null) => (x ? x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null)
  const period = note ? ` · ${note}` : d(start) && d(end) ? ` · ${d(start)} – ${d(end)}` : ''
  const what = (sub.lines.length ? sub.lines : lines.map(l => ({ label: l.kind }))).map(l => l.label).join(', ') || 'Subscription'
  const amountInr = Number(payment.amount) / 100
  await controlPlanePool()
    .query(
      `INSERT INTO settlement_ledger (tenant_id, entry_type, amount, external_ref, note)
       VALUES ($1, 'subscription_charge', $2, $3, $4)
       ON CONFLICT (tenant_id, entry_type, external_ref) WHERE external_ref IS NOT NULL DO NOTHING`,
      [sub.tenantId, -amountInr, payment.id, `Jeffi subscription: ${what}${period}`]
    )
    .catch(e => console.error(`[billing:webhook] settlement_ledger write failed: ${e?.message}`))
  issuePlatformInvoiceLater({
    tenantId: sub.tenantId,
    kind: 'subscription',
    externalRef: payment.id,
    sac: '998315',
    description: `Jeffi subscription (${sub.interval}): ${what}${period}`,
    amountInr,
    pricesIncludeGst: true,
  })
}

/**
 * Decision 6: lines removed (or lowered) while the owner hasn't approved the lower mandate are still in this
 * subscription's amount, so what it charges above what its running lines cost now is refunded on each charge.
 */
export function refundDue(sub: Pick<BillingSubscription, 'amountPaise' | 'interval'>, lines: readonly BillingLine[], at = Date.now()): number {
  const owed = cyclePaise(monthlyTotal(lines, at, paidHere), sub.interval)
  return Math.max(0, sub.amountPaise - owed)
}

async function refundRemoved(sub: BillingSubscription, payment: any, lines: readonly BillingLine[], chargeId: string): Promise<void> {
  const due = Math.min(refundDue(sub, lines), Number(payment.amount) || 0)
  if (due <= 0) return
  await refundPayment(payment.id, due, { reason: 'billing_line_removed', billing_subscription_id: sub.id })
  await controlPlanePool().query(`UPDATE billing_charges SET refunded_paise = $2 WHERE id = $1`, [chargeId, due])
}

async function onHalted(sub: BillingSubscription): Promise<void> {
  const graceUntil = new Date(Date.now() + GRACE_DAYS * DAY_MS)
  await controlPlanePool().query(`UPDATE billing_subscriptions SET status = 'halted', grace_until = $2, updated_at = now() WHERE id = $1`, [sub.id, graceUntil.toISOString()])
  if (!sub.isCurrent) return
  const lines = await listLines(sub.tenantId)
  const running = lines.filter(l => l.status === 'active' || l.status === 'ending')
  await controlPlanePool().query(
    `UPDATE billing_lines SET grace_until = $2, updated_at = now() WHERE tenant_id = $1 AND status IN ('active','ending')`,
    [sub.tenantId, graceUntil.toISOString()]
  )
  // Decision 7: the store suspends at once; sites and add-ons run until the grace ends.
  await extendEntitlements(sub.tenantId, running.filter(l => l.kind !== 'store_plan'), graceUntil)
  const store = hasStore(running)
  if (store) await setSubscriptionStatus(sub.tenantId, 'halted', 'suspended')
  await notifyBilling(sub.tenantId, { kind: 'halted', graceUntil: graceUntil.toISOString(), store }).catch(() => {})
}

async function onResumed(sub: BillingSubscription): Promise<void> {
  await setStatus(sub, 'active', ', grace_until = NULL')
  if (!sub.isCurrent) return
  await controlPlanePool().query(`UPDATE billing_lines SET grace_until = NULL, updated_at = now() WHERE tenant_id = $1 AND grace_until IS NOT NULL`, [sub.tenantId])
  const lines = await listLines(sub.tenantId)
  if (hasStore(lines)) {
    const t = (await controlPlanePool().query<{ status: string }>(`SELECT status FROM tenants WHERE id = $1`, [sub.tenantId])).rows[0]
    await setSubscriptionStatus(sub.tenantId, 'active', t?.status === 'suspended' ? 'active' : undefined)
  }
}

/** A replaced or abandoned subscription ending is expected. Otherwise its lines end with the paid period. */
async function onEnded(sub: BillingSubscription, status: string, entity: any): Promise<void> {
  if (GONE.includes(sub.status)) return
  await setStatus(sub, status, ', is_current = false')
  if (!sub.isCurrent) return
  const store = hasStore(await listLines(sub.tenantId))
  const end = sec(entity.current_end) ?? sec(entity.ended_at) ?? new Date()
  const ended = end.getTime() <= Date.now()
  await controlPlanePool().query(
    `UPDATE billing_lines SET status = $2, ends_at = LEAST(COALESCE(ends_at, $3::timestamptz), $3::timestamptz), updated_at = now()
      WHERE tenant_id = $1 AND status IN ('active','ending','awaiting_payment')`,
    [sub.tenantId, ended ? 'ended' : 'ending', end.toISOString()]
  )
  // Only a store is closed; a Showcase-only workspace stays. An end still ahead is closed by the sweep.
  if (!store) return
  if (status === 'expired') await setSubscriptionStatus(sub.tenantId, 'expired', 'suspended')
  else if (ended) await closeStore(sub.tenantId, status)
}
