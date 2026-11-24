import 'server-only'
import { controlPlanePool, setSubscriptionStatus, stopProvisioningJob } from '@/lib/tenant-registry'
import { pauseShowcase } from '@/lib/showcase/store'
import { SHOWCASE_PRICE_INR } from '@/lib/showcase/types'
import { cancelSubscription, getSubscription, listSubscriptionInvoices } from '@controller/lib/payments/razorpay-subscriptions'
import { triggerProvisioning } from '@controller/lib/provisioning/trigger'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'
import { DAY_MS, effectivePaise, lineLabels, listLines, patchLine, releaseUnstartedLines, toLine, type BillingLine } from './lines'
import { abandonPending, currentSubscription, isPaying, toSubscription } from './subscription'
import { extendEntitlements } from './entitlements'
import { notifyBilling } from './notify'

// The daily billing_sweep cron: trial reminders and trial-end pauses, grace-end pauses, lines reaching their end,
// migration notices and deadlines, abandoned checkouts, and a subscriptions.fetch catch-up for missed webhooks.

export const TRIAL_REMIND_DAYS = 2 // day 5 of the 7-day trial
export const ABANDON_AFTER_DAYS = 3
export const MIGRATE_REMIND_DAYS = 3

export interface SweepRun {
  synced: number
  trialReminders: number
  trialsEnded: number
  gracePaused: number
  linesEnded: number
  storesClosed: number
  migrationNotices: number
  migrationsLapsed: number
  abandoned: number
  reconciled: number
  failed: { what: string; error: string }[]
}

const pool = () => controlPlanePool()
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Terminate a store and tear it down (backup first, in the engine). */
export async function closeStore(tenantId: string, status = 'cancelled'): Promise<boolean> {
  const t = (await pool().query<{ slug: string; status: string }>(`SELECT slug, status FROM tenants WHERE id = $1`, [tenantId])).rows[0]
  if (!t || t.status === 'terminated') return false
  await setSubscriptionStatus(tenantId, status, 'terminated')
  const owner = (await pool().query<{ owner_id: string }>(`SELECT owner_id FROM owner_tenants WHERE tenant_id = $1 LIMIT 1`, [tenantId]).catch(() => null))?.rows[0]
  // A build still going is stopped first (it can take a minute), so the teardown never reads as a finished build.
  void (async () => {
    await stopProvisioningJob(tenantId, 'stopped: the subscription ended').catch(() => false)
    await triggerProvisioning({ action: 'deprovision', tenantId, slug: t.slug, plan: null, ownerId: owner?.owner_id ?? null, reason: 'missed_payment' })
  })().catch(() => {})
  return true
}

/**
 * Ending lines whose end has come: ended, the site paused, the store closed. Lowered prices whose date has come
 * apply. Returns how many lines ended and stores closed.
 */
export async function closeEndedLines(tenantId?: string): Promise<{ ended: number; stores: number }> {
  const p = pool()
  await p.query(
    `UPDATE billing_lines SET amount_paise = next_amount_paise, next_amount_paise = NULL, changes_at = NULL, updated_at = now()
      WHERE next_amount_paise IS NOT NULL AND changes_at <= now() AND status <> 'ended' ${tenantId ? 'AND tenant_id = $1' : ''}`,
    tenantId ? [tenantId] : []
  )
  const r = await p.query(
    `UPDATE billing_lines SET status = 'ended', updated_at = now()
      WHERE status = 'ending' AND ends_at <= now() ${tenantId ? 'AND tenant_id = $1' : ''} RETURNING *`,
    tenantId ? [tenantId] : []
  )
  let stores = 0
  for (const l of r.rows.map(toLine)) {
    if (l.kind === 'showcase_site') await pauseShowcase(l.ref, 'unpaid').catch(() => null)
    if (l.kind === 'store_plan' && (await closeStore(l.tenantId))) stores++
  }
  return { ended: r.rowCount ?? 0, stores }
}

/** Published sites with a workspace but no line yet get one (trial while it lasts). The platform's own sites are free. */
export async function syncShowcaseLines(): Promise<number> {
  const r = await pool().query(
    `INSERT INTO billing_lines (tenant_id, kind, ref, amount_paise, status, trial_ends_at)
     SELECT s.tenant_id, 'showcase_site', s.id::text, $1, 'trial', s.trial_ends_at
       FROM showcase_sites s
      WHERE s.tenant_id IS NOT NULL AND s.tenant_id <> $2::uuid AND s.status <> 'draft' AND s.trial_ends_at > now()
        AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = s.tenant_id)
        AND NOT EXISTS (SELECT 1 FROM billing_lines l WHERE l.tenant_id = s.tenant_id AND l.kind = 'showcase_site' AND l.ref = s.id::text AND l.status <> 'ended')
     ON CONFLICT (tenant_id, kind, ref) WHERE status <> 'ended' DO NOTHING`,
    [SHOWCASE_PRICE_INR * 100, FLAGSHIP_TENANT_ID]
  )
  return r.rowCount ?? 0
}

async function siteName(line: BillingLine): Promise<string> {
  return (await lineLabels(line.tenantId, [line]))(line).replace(/^Showcase site /, '') || 'Your site'
}

// A trial line no paying subscription covers (none chosen, or a checkout never completed).
const UNCOVERED = `NOT EXISTS (SELECT 1 FROM billing_subscriptions b WHERE b.id = l.subscription_id AND b.status IN ('authenticated','active','pending'))`

/**
 * A store's first site is in its plan (decision 9): when its trial ends on a paying store workspace it starts, free,
 * on that subscription. True when it did.
 */
async function startIncludedSite(line: BillingLine): Promise<boolean> {
  const current = await currentSubscription(line.tenantId)
  if (!isPaying(current)) return false
  const lines = (await listLines(line.tenantId)).map(l => (l.id === line.id ? { ...l, status: 'active' as const } : l))
  const me = lines.find(l => l.id === line.id)
  if (!me || !lines.some(l => l.kind === 'store_plan' && l.status === 'active') || effectivePaise(me, lines) !== 0) return false
  await patchLine(line.id, { status: 'active', subscription_id: current!.id })
  const until = current!.currentEnd ?? current!.startAt
  if (until) await extendEntitlements(line.tenantId, [me], new Date(Date.parse(until) + DAY_MS))
  return true
}

/** Day 5 reminders, and day 7: a trial nobody set autopay up for pauses its site (decision 2: no grace). */
async function trials(run: SweepRun): Promise<void> {
  const remind = await pool().query(
    `SELECT l.* FROM billing_lines l WHERE l.status = 'trial' AND ${UNCOVERED}
        AND l.trial_ends_at > now() AND l.trial_ends_at <= now() + make_interval(days => $1::int)
        AND l.last_notice IS DISTINCT FROM 'trial_ending'`,
    [TRIAL_REMIND_DAYS]
  )
  for (const l of remind.rows.map(toLine)) {
    if (l.kind === 'showcase_site' && (await startIncludedSite(l).catch(() => false))) continue
    await patchLine(l.id, { last_notice: 'trial_ending' })
    await notifyBilling(l.tenantId, { kind: 'trial_ending', site: await siteName(l), endsAt: l.trialEndsAt! }).catch(() => {})
    run.trialReminders++
  }
  // Covered by a subscription that is paying (or will charge at the trial end): the charge starts it.
  const ended = await pool().query(`SELECT l.* FROM billing_lines l WHERE l.status = 'trial' AND l.trial_ends_at <= now() AND ${UNCOVERED}`)
  for (const l of ended.rows.map(toLine)) {
    if (l.kind === 'showcase_site' && (await startIncludedSite(l).catch(() => false))) continue
    await patchLine(l.id, { status: 'ended', ends_at: new Date().toISOString(), last_notice: 'trial_ended' })
    if (l.kind === 'showcase_site') {
      const site = await pauseShowcase(l.ref, 'unpaid').catch(() => null)
      if (site?.status === 'paused') await notifyBilling(l.tenantId, { kind: 'trial_ended', site: await siteName(l) }).catch(() => {})
    }
    run.trialsEnded++
  }
}

/** Halted subscriptions past their 7-day grace: sites pause (add-on entitlements already ran out with the grace). */
async function graceEnds(run: SweepRun): Promise<void> {
  const r = await pool().query(
    `SELECT l.* FROM billing_lines l
      WHERE l.grace_until <= now() AND l.status IN ('active','ending') AND l.kind = 'showcase_site'
        AND l.last_notice IS DISTINCT FROM 'grace_paused'`
  )
  for (const l of r.rows.map(toLine)) {
    await patchLine(l.id, { last_notice: 'grace_paused' })
    const site = await pauseShowcase(l.ref, 'unpaid').catch(() => null)
    if (site?.status === 'paused') {
      await notifyBilling(l.tenantId, { kind: 'site_paused', site: await siteName(l) }).catch(() => {})
      run.gracePaused++
    }
  }
}

/** Legacy wallet lines: the announcement, a reminder before the deadline, and the deadline itself. */
async function migrations(run: SweepRun): Promise<void> {
  const r = await pool().query(`SELECT * FROM billing_lines WHERE status = 'legacy_wallet' ORDER BY tenant_id, created_at`)
  const byTenant = new Map<string, BillingLine[]>()
  for (const l of r.rows.map(toLine)) byTenant.set(l.tenantId, [...(byTenant.get(l.tenantId) ?? []), l])
  const now = Date.now()
  for (const [tenantId, lines] of byTenant) {
    try {
      const label = await lineLabels(tenantId, lines)
      const lapsed = lines.filter(l => l.graceUntil && Date.parse(l.graceUntil) <= now)
      if (lapsed.length) {
        for (const l of lapsed) {
          await patchLine(l.id, { status: 'ended', ends_at: new Date().toISOString(), last_notice: 'migrate_ended' })
          if (l.kind === 'showcase_site') await pauseShowcase(l.ref, 'unpaid').catch(() => null)
        }
        await notifyBilling(tenantId, { kind: 'migrate_ended', items: lapsed.map(label) }).catch(() => {})
        run.migrationsLapsed += lapsed.length
      }
      const open = lines.filter(l => !lapsed.includes(l))
      if (!open.length) continue
      const deadline = open.map(l => l.graceUntil!).filter(Boolean).sort()[0]
      const soon = deadline && Date.parse(deadline) - now <= MIGRATE_REMIND_DAYS * DAY_MS
      const kind = !open.some(l => l.lastNotice) ? 'migrate_announce' : soon && !open.some(l => l.lastNotice === 'migrate_remind') ? 'migrate_remind' : null
      if (!kind || !deadline) continue
      for (const l of open) await patchLine(l.id, { last_notice: kind })
      await notifyBilling(tenantId, { kind, deadline, items: open.map(label) }).catch(() => {})
      run.migrationNotices++
    } catch (e) {
      run.failed.push({ what: `migration ${tenantId}`, error: errText(e) })
    }
  }
}

/**
 * Checkouts nobody completed: a replacement after ABANDON_AFTER_DAYS (or once its start date has passed: the old one
 * charged for that cycle), a first
 * subscription for add-ons or sites after a week. A store's first checkout waits (the store is awaiting payment).
 */
async function abandoned(run: SweepRun): Promise<void> {
  const r = await pool().query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM billing_subscriptions
      WHERE status = 'created' AND NOT is_current AND replaces_id IS NOT NULL
        AND (created_at < now() - make_interval(days => $1::int) OR start_at < now())`,
    [ABANDON_AFTER_DAYS]
  )
  for (const { tenant_id } of r.rows) run.abandoned += await abandonPending(tenant_id).catch(() => 0)

  const first = await pool().query(
    `SELECT b.* FROM billing_subscriptions b
      WHERE b.status = 'created' AND b.is_current AND b.created_at < now() - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM billing_lines l WHERE l.tenant_id = b.tenant_id AND l.kind = 'store_plan' AND l.status <> 'ended')`
  )
  for (const b of first.rows.map(toSubscription)) {
    await pool().query(`UPDATE billing_subscriptions SET status = 'abandoned', is_current = false, updated_at = now() WHERE id = $1`, [b.id])
    await releaseUnstartedLines(b.id)
    await cancelSubscription(b.razorpaySubscriptionId, { cancelAtCycleEnd: false }).catch(() => {})
    run.abandoned++
  }
}

const RZP_TO_EVENT: Record<string, string> = {
  authenticated: 'subscription.authenticated',
  active: 'subscription.activated',
  pending: 'subscription.pending',
  halted: 'subscription.halted',
  cancelled: 'subscription.cancelled',
  completed: 'subscription.completed',
  expired: 'subscription.expired',
}

/** Missed webhooks: compare live subscriptions with Razorpay and replay what changed, charges included. */
async function reconcile(run: SweepRun): Promise<void> {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return
  const { onBillingSubscription } = await import('./webhook')
  const r = await pool().query(
    `SELECT * FROM billing_subscriptions
      WHERE (is_current OR (status = 'created' AND replaces_id IS NOT NULL))
        AND status IN ('created','authenticated','active','pending','halted')
        AND (current_end IS NULL OR current_end < now() OR last_event_at IS NULL OR last_event_at < now() - interval '2 days')
      ORDER BY updated_at LIMIT 200`
  )
  for (const sub of r.rows.map(toSubscription)) {
    try {
      const entity = await getSubscription(sub.razorpaySubscriptionId)
      const ctx = { tenantId: sub.tenantId, eventId: `sweep:${sub.id}` }
      const nowSec = Math.floor(Date.now() / 1000)
      const known = await pool().query<{ razorpay_payment_id: string }>(`SELECT razorpay_payment_id FROM billing_charges WHERE subscription_id = $1`, [sub.id])
      const seen = new Set(known.rows.map(k => k.razorpay_payment_id))
      if (['active', 'authenticated', 'pending', 'halted'].includes(entity?.status)) {
        for (const inv of await listSubscriptionInvoices(sub.razorpaySubscriptionId).catch(() => [])) {
          if (inv.status !== 'paid' || !inv.payment_id || seen.has(inv.payment_id)) continue
          await onBillingSubscription('subscription.charged', { created_at: inv.paid_at ?? nowSec, payload: { subscription: { entity }, payment: { entity: { id: inv.payment_id, amount: inv.amount, invoice_id: inv.id } } } }, ctx)
          run.reconciled++
        }
      }
      const event = RZP_TO_EVENT[entity?.status]
      if (event && entity.status !== sub.status) {
        await onBillingSubscription(event, { created_at: nowSec, payload: { subscription: { entity } } }, ctx)
        run.reconciled++
      }
    } catch (e) {
      run.failed.push({ what: `reconcile ${sub.razorpaySubscriptionId}`, error: errText(e) })
    }
  }
}

export async function runBillingSweep(): Promise<SweepRun> {
  const run: SweepRun = { synced: 0, trialReminders: 0, trialsEnded: 0, gracePaused: 0, linesEnded: 0, storesClosed: 0, migrationNotices: 0, migrationsLapsed: 0, abandoned: 0, reconciled: 0, failed: [] }
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      run.failed.push({ what, error: errText(e) })
    }
  }
  await step('reconcile', () => reconcile(run))
  await step('sync', async () => (run.synced = await syncShowcaseLines()))
  await step('trials', () => trials(run))
  await step('grace', () => graceEnds(run))
  await step('ended', async () => {
    const r = await closeEndedLines()
    run.linesEnded = r.ended
    run.storesClosed = r.stores
  })
  await step('migrations', () => migrations(run))
  await step('abandoned', () => abandoned(run))
  return run
}
