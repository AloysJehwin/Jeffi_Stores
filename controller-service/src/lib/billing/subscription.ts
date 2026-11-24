import 'server-only'
import type { PoolClient } from 'pg'
import { controlPlanePool } from '@/lib/tenant-registry'
import {
  cancelSubscription,
  createBillingSubscription,
  getSubscription,
  razorpayMode,
  type BillingInterval,
} from '@controller/lib/payments/razorpay-subscriptions'
import {
  cyclePaise,
  DAY_MS,
  effectivePaise,
  listLines,
  listPricePaise,
  monthlyTotal,
  openLine,
  patchLine,
  paymentMethodsFor,
  prorationPaise,
  releaseUnstartedLines,
  sameLine,
  snapshot,
  type BillingLine,
  type LineKind,
  type LineStatus,
  type OnBill,
  type PaymentMethod,
  type SnapshotLine,
  STORE_ONLY,
} from './lines'
import { extendEntitlements } from './entitlements'

// One Razorpay subscription per workspace, its amount the sum of its lines (docs/plans/SUBSCRIPTION_BILLING_PLAN.md).
// Razorpay rejects subscriptions.update for UPI and eMandate, so every change of amount is a replacement: a new
// subscription starting at the old one's current_end (the billing date doesn't move). An increase collects the
// difference for the rest of the cycle upfront and takes effect at the replacement's authentication (webhook.ts); a
// decrease takes effect at cycle end with no mid-cycle refund. Nothing is cancelled before the owner authorises.

export interface PendingChange {
  /** Store plan move applied when the replacement takes effect. */
  plan?: { slug: string; interval: BillingInterval }
  spec?: unknown
  applyMode?: 'window' | 'now'
  /** Line prices raised by this change (an increase only applies once authorised). */
  amounts?: { kind: LineKind; ref: string; amountPaise: number }[]
  /** Pay now on a halted subscription: the old one is cancelled at once, not at cycle end. */
  replaceNow?: boolean
  ownerId?: string | null
}

export interface BillingSubscription {
  id: string
  tenantId: string
  razorpaySubscriptionId: string
  razorpayPlanId: string | null
  mode: 'test' | 'live'
  status: string
  isCurrent: boolean
  interval: BillingInterval
  amountPaise: number
  upfrontPaise: number
  lines: SnapshotLine[]
  pendingChange: PendingChange | null
  paymentMethod: string | null
  replacesId: string | null
  startAt: string | null
  currentStart: string | null
  currentEnd: string | null
  graceUntil: string | null
  lastEventAt: string | null
  checkoutUrl: string | null
  createdAt: string
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

export function toSubscription(r: Record<string, any>): BillingSubscription {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    razorpaySubscriptionId: r.razorpay_subscription_id,
    razorpayPlanId: r.razorpay_plan_id ?? null,
    mode: r.mode === 'test' ? 'test' : 'live',
    status: r.status,
    isCurrent: !!r.is_current,
    interval: r.billing_interval === 'yearly' ? 'yearly' : 'monthly',
    amountPaise: Number(r.amount_paise),
    upfrontPaise: Number(r.upfront_paise ?? 0),
    lines: Array.isArray(r.lines) ? r.lines : [],
    pendingChange: r.pending_change ?? null,
    paymentMethod: r.payment_method ?? null,
    replacesId: r.replaces_id ?? null,
    startAt: iso(r.start_at),
    currentStart: iso(r.current_start),
    currentEnd: iso(r.current_end),
    graceUntil: iso(r.grace_until),
    lastEventAt: iso(r.last_event_at),
    checkoutUrl: r.checkout_url ?? null,
    createdAt: iso(r.created_at)!,
  }
}

type Q = Pick<PoolClient, 'query'>
const q = (c?: Q): Q => c ?? controlPlanePool()

export async function currentSubscription(tenantId: string, client?: Q): Promise<BillingSubscription | null> {
  const r = await q(client).query(`SELECT * FROM billing_subscriptions WHERE tenant_id = $1 AND is_current`, [tenantId])
  return r.rows[0] ? toSubscription(r.rows[0]) : null
}

export async function subscriptionByRazorpayId(rzpId: string, client?: Q): Promise<BillingSubscription | null> {
  const r = await q(client).query(`SELECT * FROM billing_subscriptions WHERE razorpay_subscription_id = $1`, [rzpId])
  return r.rows[0] ? toSubscription(r.rows[0]) : null
}

export async function getBillingSubscription(id: string, client?: Q): Promise<BillingSubscription | null> {
  const r = await q(client).query(`SELECT * FROM billing_subscriptions WHERE id = $1`, [id])
  return r.rows[0] ? toSubscription(r.rows[0]) : null
}

/** A replacement still waiting for the owner (not current yet). */
export async function pendingReplacement(tenantId: string, client?: Q): Promise<BillingSubscription | null> {
  const r = await q(client).query(
    `SELECT * FROM billing_subscriptions WHERE tenant_id = $1 AND NOT is_current AND status = 'created' AND replaces_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId]
  )
  return r.rows[0] ? toSubscription(r.rows[0]) : null
}

export async function listSubscriptions(tenantId: string, limit = 20): Promise<BillingSubscription[]> {
  const r = await controlPlanePool().query(`SELECT * FROM billing_subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`, [tenantId, limit])
  return r.rows.map(toSubscription)
}

/** A subscription the workspace is paying on (not waiting for a first checkout, not halted or ended). */
export const isPaying = (s: BillingSubscription | null) => !!s && ['authenticated', 'active', 'pending'].includes(s.status)

// ── Planning a change (pure) ─────────────────────────────────────────────────

export interface LineInput {
  kind: LineKind
  ref?: string
  amountPaise?: number
  trialEndsAt?: string | null
}
export type LineRef = { kind: LineKind; ref?: string }

export interface Change {
  add?: LineInput[]
  remove?: LineRef[]
  /** A new monthly price for an open line (a store plan or server change). */
  amounts?: (LineRef & { amountPaise: number })[]
  interval?: BillingInterval
  pendingChange?: PendingChange
  /** Start now rather than at the current cycle end (a first subscription always does). */
  immediate?: boolean
  /** Bring legacy_wallet lines onto the subscription (the migration). */
  migrate?: boolean
}

export type ChangeKind = 'new' | 'increase' | 'decrease' | 'cancel' | 'unchanged'

export interface PlannedChange {
  kind: ChangeKind
  interval: BillingInterval
  /** The lines after the change, as stored or to be stored ('new:' ids are not stored yet). */
  after: BillingLine[]
  added: BillingLine[]
  removed: BillingLine[]
  /** Lines whose price goes down at cycle end. */
  lowered: { line: BillingLine; amountPaise: number }[]
  /** Lines whose price goes up once the new subscription is authorised. */
  raised: { line: BillingLine; amountPaise: number }[]
  /** Lines not yet paid on a subscription whose price changes now. */
  repriced: { line: BillingLine; amountPaise: number }[]
  /** Ending lines kept after all. */
  restored: BillingLine[]
  /** Trials the new subscription covers from their end. */
  covered: BillingLine[]
  /** Legacy wallet lines brought onto the subscription. */
  migrated: BillingLine[]
  /** Added or covered lines that cost nothing (the store's included site): they start at once. */
  free: BillingLine[]
  /** Which lines the new amount charges for, and the time it is priced at. */
  onBill: OnBill
  at: number
  beforeCyclePaise: number
  monthlyPaise: number
  cyclePaise: number
  upfrontPaise: number
  /** Unix ms of the first charge, null = at authorisation. */
  startAt: number | null
  replaceNow: boolean
  methods: PaymentMethod[]
}

const ms = (v: string | null) => (v ? Date.parse(v) : null)
/** Razorpay wants start_at comfortably in the future. */
const MIN_START_AHEAD_MS = 3_600_000

/**
 * What a change does to a workspace's bill. `current` is the subscription it is billed on (null when none).
 * Prices for added lines must already be set (amountPaise). A trial is on the bill only when the owner chose it
 * (covered or added here, or already on the paying subscription); an ending line is never on the new amount but
 * still runs (and keeps the store's included site free) for the rest of the cycle.
 */
export function planChange(tenantId: string, lines: readonly BillingLine[], current: BillingSubscription | null, change: Change, now = Date.now()): PlannedChange {
  const paying = isPaying(current)
  const interval: BillingInterval = change.interval ?? current?.interval ?? 'monthly'
  let cycleEnd = paying ? ms(current!.currentEnd) : null
  let cycleStart = paying ? ms(current!.currentStart) : null
  // Authorised but not charged yet (a trial start, or a replacement waiting for its start): its first charge ends the cycle.
  if (paying && !(cycleEnd != null && cycleEnd > now) && (ms(current!.startAt) ?? 0) > now) {
    cycleEnd = ms(current!.startAt)!
    cycleStart = cycleEnd - (current!.interval === 'yearly' ? 365 : 30) * DAY_MS
  }
  const knownCycle = cycleEnd != null && cycleStart != null && cycleEnd > now
  const nowIso = new Date(now).toISOString()
  const halted = current?.status === 'halted'

  const onCurrent = (l: BillingLine) =>
    paying && (l.status === 'active' || l.status === 'ending' || ((l.status === 'trial' || l.status === 'awaiting_payment') && l.subscriptionId === current!.id))
  const before = lines.filter(onCurrent)

  const after: BillingLine[] = lines.map(l => ({ ...l }))
  const added: BillingLine[] = []
  const removed: BillingLine[] = []
  const lowered: PlannedChange['lowered'] = []
  const raised: PlannedChange['raised'] = []
  const repriced: PlannedChange['repriced'] = []
  const restored: BillingLine[] = []
  const covered: BillingLine[] = []
  const migrated: BillingLine[] = []
  const find = (r: LineRef) => after.find(l => sameLine(l, r) && l.status !== 'ended')
  const wasOnCurrent = new Set(after.filter(onCurrent).map(l => l.id))

  for (const r of change.remove ?? []) {
    const l = find(r)
    if (!l) continue
    removed.push(l)
    const trialLeft = l.status === 'trial' && (ms(l.trialEndsAt) ?? 0) > now
    // A running trial just leaves the bill (it pauses at its end); a paid line runs to the end of the cycle.
    if (trialLeft) Object.assign(l, { subscriptionId: null })
    else if (wasOnCurrent.has(l.id)) Object.assign(l, { status: 'ending' as LineStatus, endsAt: knownCycle ? new Date(cycleEnd!).toISOString() : null })
    else Object.assign(l, { status: 'ended' as LineStatus, endsAt: nowIso })
  }

  for (const a of change.add ?? []) {
    const existing = find(a)
    if (existing) {
      if (existing.status === 'ending') restored.push(Object.assign(existing, { status: 'active' as LineStatus, endsAt: null }))
      else if (existing.status === 'legacy_wallet') migrated.push(Object.assign(existing, { status: 'awaiting_payment' as LineStatus }))
      else if (existing.status === 'trial' && !wasOnCurrent.has(existing.id) && !removed.includes(existing)) covered.push(existing)
      continue
    }
    const trial = a.trialEndsAt && Date.parse(a.trialEndsAt) > now ? a.trialEndsAt : null
    const line: BillingLine = {
      id: `new:${a.kind}:${a.ref ?? ''}`,
      tenantId,
      kind: a.kind,
      ref: a.ref ?? '',
      amountPaise: Math.round(a.amountPaise ?? 0),
      status: trial ? 'trial' : 'awaiting_payment',
      subscriptionId: null,
      nextAmountPaise: null,
      changesAt: null,
      trialEndsAt: trial,
      endsAt: null,
      graceUntil: null,
      legacyRef: null,
      lastNotice: null,
      createdAt: nowIso,
    }
    after.push(line)
    added.push(line)
  }

  if (change.migrate) for (const l of after) if (l.status === 'legacy_wallet') migrated.push(Object.assign(l, { status: 'awaiting_payment' as LineStatus }))

  for (const c of change.amounts ?? []) {
    const l = find(c)
    if (!l) continue
    const amount = Math.round(c.amountPaise)
    if (amount === l.amountPaise && l.nextAmountPaise == null) continue
    if (wasOnCurrent.has(l.id) && knownCycle && amount < l.amountPaise) {
      Object.assign(l, { nextAmountPaise: amount, changesAt: new Date(cycleEnd!).toISOString() })
      lowered.push({ line: l, amountPaise: amount })
    } else {
      ;(wasOnCurrent.has(l.id) ? raised : repriced).push({ line: l, amountPaise: amount })
      Object.assign(l, { amountPaise: amount, nextAmountPaise: null, changesAt: null })
    }
  }

  const chosen = new Set([...covered, ...added].map(l => l.id))
  const onBill: OnBill = l =>
    l.status === 'active' || l.status === 'awaiting_payment' || (l.status === 'trial' && (chosen.has(l.id) || (wasOnCurrent.has(l.id) && !removed.includes(l))))
  // The rest of the current cycle: ending lines still run.
  const during: OnBill = (l, t) => onBill(l, t) || (l.status === 'ending' && (ms(l.endsAt) ?? Infinity) > t)
  const wasOn: OnBill = l => wasOnCurrent.has(l.id)

  const live = after.filter(l => l.status !== 'ended')
  const charged = live.filter(l => onBill(l, now) && l.status !== 'trial')
  const trialEnds = live.filter(l => l.status === 'trial' && onBill(l, now)).map(l => ms(l.trialEndsAt)!).filter(t => t > now)
  // A first subscription starts now, or when the earliest chosen trial ends if nothing else is charged yet.
  const trialStart = !paying && !change.immediate && !halted && !charged.length && trialEnds.length ? Math.min(...trialEnds) : null
  const at = knownCycle ? cycleEnd! : (trialStart ?? now)
  const monthly = monthlyTotal(live, at, onBill)
  const cycle = cyclePaise(monthly, interval)
  const beforeCycle = paying ? current!.amountPaise : 0

  let upfront = 0
  if (paying && knownCycle && !change.immediate) {
    for (const l of live.filter(x => during(x, now))) {
      const was = before.find(b => sameLine(b, l))
      const delta = effectivePaise(l, live, now, during) - (was ? effectivePaise(was, before, now, wasOn) : 0)
      if (delta <= 0) continue
      const from = Math.max(now, ms(l.trialEndsAt) ?? now)
      upfront += prorationPaise({ monthlyDeltaPaise: delta, interval: current!.interval, from, cycleStart: cycleStart!, cycleEnd: cycleEnd! })
    }
  }

  const changed =
    added.length + removed.length + lowered.length + raised.length + repriced.length + restored.length + covered.length + migrated.length > 0 ||
    interval !== (current?.interval ?? interval)
  let kind: ChangeKind
  if (!paying) kind = cycle > 0 && (changed || halted || !!change.immediate || !current) ? 'new' : 'unchanged'
  else if (cycle === 0) kind = beforeCycle > 0 ? 'cancel' : 'unchanged'
  else if (upfront > 0 || cycle > beforeCycle || (interval === 'yearly' && current!.interval === 'monthly')) kind = 'increase'
  else if (cycle < beforeCycle || (interval === 'monthly' && current!.interval === 'yearly')) kind = 'decrease'
  else kind = 'unchanged'

  let startAt: number | null = null
  if (kind === 'new') startAt = trialStart != null && trialStart - now > MIN_START_AHEAD_MS ? trialStart : null
  else if ((kind === 'increase' || kind === 'decrease') && !change.immediate) startAt = knownCycle ? cycleEnd : null

  const free = [...added, ...covered, ...migrated].filter(l => onBill(l, at) && effectivePaise(l, live, at, onBill) === 0)

  return {
    kind,
    interval,
    after: live,
    added,
    removed,
    lowered,
    raised,
    repriced,
    restored,
    covered,
    migrated,
    free,
    onBill,
    at: startAt ?? at,
    beforeCyclePaise: beforeCycle,
    monthlyPaise: monthly,
    cyclePaise: cycle,
    upfrontPaise: kind === 'increase' ? upfront : 0,
    startAt,
    replaceNow: halted || (!!change.immediate && paying),
    methods: paymentMethodsFor(),
  }
}

// ── Quotes and changes ───────────────────────────────────────────────────────

export interface Quote {
  kind: ChangeKind
  interval: BillingInterval
  lines: SnapshotLine[]
  monthlyPaise: number
  cyclePaise: number
  beforeCyclePaise: number
  upfrontPaise: number
  startAt: string | null
  methods: PaymentMethod[]
  current: { id: string; status: string; currentEnd: string | null } | null
}

async function priced(tenantId: string, change: Change): Promise<Change> {
  const add = await Promise.all((change.add ?? []).map(async a => (a.amountPaise != null ? a : { ...a, amountPaise: await listPricePaise(a.kind, tenantId) })))
  return { ...change, add }
}

/** Fills a paying subscription's current cycle from Razorpay when it isn't known yet (a backfilled one). */
async function withCycle(sub: BillingSubscription | null): Promise<BillingSubscription | null> {
  if (!sub || !isPaying(sub) || (sub.currentEnd && Date.parse(sub.currentEnd) > Date.now())) return sub
  // Not charged yet: its start date ends the cycle (planChange).
  if (sub.startAt && Date.parse(sub.startAt) > Date.now()) return sub
  const rz = await getSubscription(sub.razorpaySubscriptionId).catch(() => null)
  if (!rz?.current_end) return sub
  const start = rz.current_start ? new Date(rz.current_start * 1000).toISOString() : null
  const end = new Date(rz.current_end * 1000).toISOString()
  await controlPlanePool().query(`UPDATE billing_subscriptions SET current_start = $2, current_end = $3, updated_at = now() WHERE id = $1`, [sub.id, start, end])
  return { ...sub, currentStart: start, currentEnd: end }
}

async function load(tenantId: string, change: Change) {
  const [lines, current, full] = await Promise.all([listLines(tenantId), currentSubscription(tenantId).then(withCycle), priced(tenantId, change)])
  return { lines, current, change: full }
}

function toQuote(p: PlannedChange, current: BillingSubscription | null, lines: SnapshotLine[]): Quote {
  return {
    kind: p.kind,
    interval: p.interval,
    lines,
    monthlyPaise: p.monthlyPaise,
    cyclePaise: p.cyclePaise,
    beforeCyclePaise: p.beforeCyclePaise,
    upfrontPaise: p.upfrontPaise,
    startAt: p.startAt ? new Date(p.startAt).toISOString() : null,
    methods: p.methods,
    current: current ? { id: current.id, status: current.status, currentEnd: current.currentEnd } : null,
  }
}

export async function quote(tenantId: string, change: Change = {}): Promise<Quote> {
  const { lines, current, change: full } = await load(tenantId, change)
  const p = planChange(tenantId, lines, current, full)
  return toQuote(p, current, await snapshot(tenantId, p.after, p.at, p.onBill))
}

export type ChangeResult =
  | { status: 'checkout'; checkoutUrl: string; subscriptionId: string; razorpaySubscriptionId: string; quote: Quote }
  | { status: 'scheduled'; effectiveAt: string | null; checkoutUrl: string | null; quote: Quote }
  | { status: 'cancelled'; endsAt: string | null; quote: Quote }
  | { status: 'unchanged'; quote: Quote }

export interface Payer {
  email: string
  name?: string | null
}

/**
 * Apply a change to a workspace's bill: write its lines and, when the amount changes, create the subscription the
 * owner authorises. Throws on a Razorpay or database failure before anything is written.
 */
export async function applyChange(tenantId: string, change: Change, payer: Payer): Promise<ChangeResult> {
  const { lines, current, change: full } = await load(tenantId, change)
  const p = planChange(tenantId, lines, current, full)
  const snap = await snapshot(tenantId, p.after, p.at, p.onBill)
  const qt = toQuote(p, current, snap)
  const pool = controlPlanePool()
  const paying = isPaying(current)

  if (p.kind === 'unchanged') {
    // Nothing more to charge (the store's included site): it goes straight onto the paying subscription.
    await writeLines(p, paying ? current!.id : null)
    await startFree(tenantId, p, current)
    return { status: 'unchanged', quote: qt }
  }
  if (p.kind === 'cancel') {
    await cancelSubscription(current!.razorpaySubscriptionId, { cancelAtCycleEnd: true })
    await writeLines(p, null)
    await abandonPending(tenantId)
    return { status: 'cancelled', endsAt: current!.currentEnd, quote: qt }
  }

  const tenant = (await pool.query<{ slug: string }>(`SELECT slug FROM tenants WHERE id = $1`, [tenantId])).rows[0]
  // Applied at authorisation: only an increase (or Pay now) carries it; a decrease moves the store at cycle end.
  const amounts = p.raised.map(r => ({ kind: r.line.kind, ref: r.line.ref, amountPaise: r.amountPaise }))
  const pendingChange: PendingChange | null =
    p.kind === 'increase' || p.replaceNow ? { ...(full.pendingChange ?? {}), ...(amounts.length ? { amounts } : {}), ...(p.replaceNow ? { replaceNow: true } : {}) } : null
  const replaces = paying || current?.status === 'halted' ? current : null
  const isFirst = !replaces

  const id = (await pool.query<{ id: string }>(`SELECT public.uuid_generate_v4() AS id`)).rows[0].id
  const created = await createBillingSubscription({
    interval: p.interval,
    amountPaise: p.cyclePaise,
    startAt: p.startAt ? Math.floor(p.startAt / 1000) : null,
    upfrontPaise: p.upfrontPaise,
    upfrontLabel: 'Added for the rest of this billing cycle',
    ownerEmail: payer.email,
    notes: { tenant_id: tenantId, tenant_slug: tenant?.slug ?? '', billing: '1', billing_subscription_id: id },
  })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // A first subscription is current at once; a replacement only once the owner authorises it (webhook.ts).
    if (isFirst && current) {
      await client.query(`UPDATE billing_subscriptions SET is_current = false, status = 'abandoned', updated_at = now() WHERE id = $1`, [current.id])
    }
    await client.query(
      `INSERT INTO billing_subscriptions (id, tenant_id, razorpay_subscription_id, razorpay_plan_id, mode, status, is_current, billing_interval,
         amount_paise, upfront_paise, lines, pending_change, replaces_id, start_at, checkout_url)
       VALUES ($1, $2, $3, $4, $5, 'created', $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14)`,
      [
        id, tenantId, created.subscriptionId, created.planId, razorpayMode(), isFirst, p.interval, p.cyclePaise, p.upfrontPaise,
        JSON.stringify(snap), pendingChange ? JSON.stringify(pendingChange) : null, replaces?.id ?? null,
        p.startAt ? new Date(p.startAt).toISOString() : null, created.shortUrl || null,
      ]
    )
    await client.query(
      `INSERT INTO razorpay_subscription_index (razorpay_subscription_id, tenant_id, collecting_account, local_subscription_id)
       VALUES ($1, $2, 'billing', $3) ON CONFLICT (razorpay_subscription_id) DO NOTHING`,
      [created.subscriptionId, tenantId, id]
    )
    await writeLines(p, id, client)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    await cancelSubscription(created.subscriptionId, { cancelAtCycleEnd: false }).catch(() => {})
    throw e
  } finally {
    client.release()
  }
  await startFree(tenantId, p, current)
  // A store's first checkout is mirrored on the tenant row (onboarding and the admin read it from there).
  if (isFirst && p.after.some(l => l.kind === 'store_plan' && p.onBill(l, p.at))) {
    await pool.query(
      `UPDATE tenants SET razorpay_subscription_id = $2, subscription_status = 'created', billing_interval = $3, razorpay_checkout_url = $4, updated_at = now()
        WHERE id = $1`,
      [tenantId, created.subscriptionId, p.interval, created.shortUrl || null]
    )
  }
  // An earlier replacement still waiting for the owner is replaced by this one (its lines moved over above).
  await abandonPending(tenantId, id)
  // The unpaid first checkout it replaces.
  if (isFirst && current) await cancelSubscription(current.razorpaySubscriptionId, { cancelAtCycleEnd: false }).catch(() => {})

  if (p.kind === 'decrease') return { status: 'scheduled', effectiveAt: current?.currentEnd ?? null, checkoutUrl: created.shortUrl || null, quote: qt }
  return { status: 'checkout', checkoutUrl: created.shortUrl, subscriptionId: id, razorpaySubscriptionId: created.subscriptionId, quote: qt }
}

/** Free lines started on a paying subscription run to its cycle end like the rest. */
async function startFree(tenantId: string, p: PlannedChange, current: BillingSubscription | null): Promise<void> {
  if (!p.free.length || !isPaying(current) || !current!.currentEnd) return
  const stored = await listLines(tenantId)
  const free = stored.filter(l => p.free.some(f => sameLine(f, l)))
  await extendEntitlements(tenantId, free, new Date(Date.parse(current!.currentEnd) + DAY_MS)).catch(() => [])
}

/**
 * Writes the planned lines. Lines waiting for a payment (new, migrated, or left by an earlier replacement this one
 * replaces) and newly chosen trials point at `subscriptionId`; free ones start at once.
 */
async function writeLines(p: PlannedChange, subscriptionId: string | null, client?: Q): Promise<void> {
  const c = q(client)
  const sub = subscriptionId ? { subscription_id: subscriptionId } : {}
  const isFree = (l: BillingLine) => p.free.some(f => sameLine(f, l))
  for (const l of p.removed) {
    if (l.status === 'trial') await patchLine(l.id, { subscription_id: null }, c)
    else if (l.status === 'ending') await patchLine(l.id, { status: 'ending', ends_at: l.endsAt }, c)
    else await patchLine(l.id, { status: 'ended', ends_at: l.endsAt ?? new Date().toISOString() }, c)
  }
  for (const { line, amountPaise } of p.lowered) await patchLine(line.id, { next_amount_paise: amountPaise, changes_at: line.changesAt }, c)
  // Raised prices on a paid line apply once the replacement is authorised (pending_change.amounts).
  for (const { line, amountPaise } of p.repriced) await patchLine(line.id, { amount_paise: amountPaise, next_amount_paise: null, changes_at: null }, c)
  for (const l of p.restored) await patchLine(l.id, { status: 'active', ends_at: null }, c)
  for (const l of p.migrated) await patchLine(l.id, isFree(l) ? { status: 'active', ...sub } : { status: 'awaiting_payment', ...sub }, c)
  for (const l of p.covered) await patchLine(l.id, isFree(l) ? { status: 'active', ...sub } : sub, c)
  for (const l of p.after) {
    if (l.status === 'awaiting_payment' && !l.id.startsWith('new:') && subscriptionId && l.subscriptionId !== subscriptionId && !p.migrated.includes(l)) {
      await patchLine(l.id, sub, c)
    }
  }
  for (const l of p.added) {
    const row = await openLine({ tenantId: l.tenantId, kind: l.kind, ref: l.ref, amountPaise: l.amountPaise, status: isFree(l) ? 'active' : l.status, trialEndsAt: l.trialEndsAt }, c)
    if (subscriptionId && (row.status === 'awaiting_payment' || row.status === 'trial' || isFree(l))) await patchLine(row.id, sub, c)
  }
}

/** Replacements still waiting for the owner become abandoned (other than `keep`), and are cancelled at Razorpay. */
export async function abandonPending(tenantId: string, keep?: string): Promise<number> {
  const r = await controlPlanePool().query<{ id: string; razorpay_subscription_id: string }>(
    `UPDATE billing_subscriptions SET status = 'abandoned', updated_at = now()
      WHERE tenant_id = $1 AND NOT is_current AND status = 'created' AND id IS DISTINCT FROM $2 RETURNING id, razorpay_subscription_id`,
    [tenantId, keep ?? null]
  )
  for (const s of r.rows) {
    await cancelSubscription(s.razorpay_subscription_id, { cancelAtCycleEnd: false }).catch(() => {})
    await releaseUnstartedLines(s.id)
  }
  return r.rowCount ?? 0
}

// ── Workflows ────────────────────────────────────────────────────────────────

export const addLine = (tenantId: string, line: LineInput, payer: Payer) => applyChange(tenantId, { add: [line] }, payer)
export const removeLine = (tenantId: string, line: LineRef, payer: Payer) => applyChange(tenantId, { remove: [line] }, payer)

/** Pay now on a halted subscription: a replacement that charges at once and cancels the halted one. */
export async function payNow(tenantId: string, payer: Payer): Promise<ChangeResult> {
  const current = await currentSubscription(tenantId)
  if (current?.status !== 'halted') throw new Error('Nothing is overdue.')
  return applyChange(tenantId, { immediate: true }, payer)
}

/** Cancel everything at cycle end (a Showcase-only workspace closing). */
export async function cancelAll(tenantId: string, payer: Payer): Promise<ChangeResult> {
  const lines = await listLines(tenantId)
  return applyChange(tenantId, { remove: lines.filter(l => l.status !== 'legacy_wallet').map(l => ({ kind: l.kind, ref: l.ref })) }, payer)
}

/**
 * A Mandatory store's first subscription at KYC approval: its plan (at priceInrMonth, else tenant_compute's price) plus
 * the add-ons picked at signup, charged at checkout. applyChange mirrors it onto the tenant row; the requests it
 * included are cleared.
 */
export async function startStoreSubscription(tenantId: string, payer: Payer, priceInrMonth?: number): Promise<ChangeResult> {
  const pool = controlPlanePool()
  const t = (await pool.query<{ requested_addons: string[] | null; billing_interval: string | null }>(`SELECT requested_addons, billing_interval FROM tenants WHERE id = $1`, [tenantId])).rows[0]
  const requested = (t?.requested_addons ?? []).filter(a => a === 'ad_free' || a === 'messaging')
  const plan: LineInput = { kind: 'store_plan', ...(priceInrMonth && priceInrMonth > 0 ? { amountPaise: Math.round(priceInrMonth * 100) } : {}) }
  const add: LineInput[] = [plan, ...requested.map(a => (a === 'ad_free' ? { kind: 'ad_free' as const } : { kind: 'messaging_addon' as const, ref: 'both' }))]
  const interval: BillingInterval = t?.billing_interval === 'yearly' ? 'yearly' : 'monthly'
  const result = await applyChange(tenantId, { add, interval, immediate: true }, payer)
  if (result.status === 'checkout' && requested.length) {
    await pool.query(`UPDATE tenants SET requested_addons = '{}'::text[], updated_at = now() WHERE id = $1`, [tenantId])
  }
  return result
}

/**
 * A store's plan or servers change. Higher: a replacement collecting the difference upfront, and the plan moves only
 * when the owner authorises it (pending_change). Lower: the price drops at cycle end; the caller holds the plan move
 * (setPendingPlan) until the next charge applies it.
 */
export function changeStorePlan(
  tenantId: string,
  c: { planSlug: string; interval: BillingInterval; priceInrMonth: number; spec?: unknown; applyMode?: 'window' | 'now'; ownerId?: string | null },
  payer: Payer
): Promise<ChangeResult> {
  const amountPaise = Math.round(c.priceInrMonth * 100)
  return applyChange(
    tenantId,
    {
      // add is a no-op when the store already has its line (a store from before the backfill gets one).
      add: [{ kind: 'store_plan', amountPaise }],
      amounts: [{ kind: 'store_plan', ref: '', amountPaise }],
      interval: c.interval,
      pendingChange: { plan: { slug: c.planSlug, interval: c.interval }, spec: c.spec, applyMode: c.applyMode, ownerId: c.ownerId ?? null },
    },
    payer
  )
}

/** Closing a store ends its plan and store-only add-ons at cycle end; Showcase sites stay on the subscription. */
export async function closeStoreLines(tenantId: string, payer: Payer): Promise<ChangeResult> {
  const lines = await listLines(tenantId)
  const remove = lines.filter(l => STORE_ONLY.includes(l.kind) && l.status !== 'legacy_wallet').map(l => ({ kind: l.kind, ref: l.ref }))
  return applyChange(tenantId, { remove }, payer)
}

export interface LineBillingState {
  /** null: not on the bill. */
  lineStatus: LineStatus | null
  /** An ending line's last day. */
  endsAt: string | null
  /** The owner still has to approve a checkout that adds it. */
  checkoutUrl: string | null
}

/** Where one line stands on the workspace's bill (the add-on cards). */
export async function lineBillingState(tenantId: string, kind: LineKind, ref = ''): Promise<LineBillingState> {
  const r = await controlPlanePool().query<{ status: LineStatus; ends_at: string | null; checkout_url: string | null; sub_status: string | null }>(
    `SELECT l.status, l.ends_at, b.checkout_url, b.status AS sub_status FROM billing_lines l
       LEFT JOIN billing_subscriptions b ON b.id = l.subscription_id
      WHERE l.tenant_id = $1 AND l.kind = $2 AND l.ref = $3 AND l.status <> 'ended'`,
    [tenantId, kind, ref]
  )
  const row = r.rows[0]
  if (!row) return { lineStatus: null, endsAt: null, checkoutUrl: null }
  return {
    lineStatus: row.status,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    checkoutUrl: row.status === 'awaiting_payment' && row.sub_status === 'created' ? row.checkout_url : null,
  }
}
