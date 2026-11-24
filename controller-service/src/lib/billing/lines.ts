import 'server-only'
import type { PoolClient } from 'pg'
import { controlPlanePool } from '@/lib/tenant-registry'
import { AD_FREE_PRICE_INR } from '@/lib/billing/ad-free'
import { getMessagingAddonPricing } from '@/lib/billing/messaging-addon'
import { SHOWCASE_PRICE_INR } from '@/lib/showcase/types'
import { showcaseHost } from '@/lib/showcase/host'
import type { BillingInterval } from '@controller/lib/payments/razorpay-subscriptions'

// What a workspace is billed for (billing_lines) and the arithmetic over it. Prices are monthly and GST-inclusive;
// a yearly subscription bills 10× monthly for every line (decision 10).

export type LineKind = 'store_plan' | 'showcase_site' | 'messaging_addon' | 'ad_free'
export type LineStatus = 'trial' | 'awaiting_payment' | 'active' | 'ending' | 'legacy_wallet' | 'ended'
export const LINE_KINDS: readonly LineKind[] = ['store_plan', 'showcase_site', 'messaging_addon', 'ad_free']

export const YEARLY_MULTIPLIER = 10
/** UPI Autopay and card mandates debit up to ₹15,000 without extra authentication. */
export const MANDATE_LIMIT_PAISE = 15_000_00
export const DAY_MS = 86_400_000

export interface BillingLine {
  id: string
  tenantId: string
  kind: LineKind
  ref: string
  amountPaise: number
  status: LineStatus
  subscriptionId: string | null
  nextAmountPaise: number | null
  changesAt: string | null
  trialEndsAt: string | null
  endsAt: string | null
  graceUntil: string | null
  legacyRef: string | null
  lastNotice: string | null
  createdAt: string
}

/** One line as a subscription charges it (billing_subscriptions.lines, billing_charges.lines). */
export interface SnapshotLine {
  kind: LineKind
  ref: string
  label: string
  amountPaise: number
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

export function toLine(r: Record<string, any>): BillingLine {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    kind: r.kind,
    ref: r.ref ?? '',
    amountPaise: Number(r.amount_paise),
    status: r.status,
    subscriptionId: r.subscription_id ?? null,
    nextAmountPaise: r.next_amount_paise == null ? null : Number(r.next_amount_paise),
    changesAt: iso(r.changes_at),
    trialEndsAt: iso(r.trial_ends_at),
    endsAt: iso(r.ends_at),
    graceUntil: iso(r.grace_until),
    legacyRef: r.legacy_ref ?? null,
    lastNotice: r.last_notice ?? null,
    createdAt: iso(r.created_at)!,
  }
}

export const cyclePaise = (monthlyPaise: number, interval: BillingInterval) => (interval === 'yearly' ? monthlyPaise * YEARLY_MULTIPLIER : monthlyPaise)
export const sameLine = (a: { kind: string; ref?: string }, b: { kind: string; ref?: string }) => a.kind === b.kind && (a.ref ?? '') === (b.ref ?? '')
const ms = (v: string | null) => (v ? Date.parse(v) : null)

/** Which lines a charge covers; chargedAt by default, a planned bill passes its own. */
export type OnBill = (line: BillingLine, at: number) => boolean

/**
 * The monthly price a line is charged at `at`. A downgraded line drops to next_amount_paise from changes_at, and a
 * workspace with a store gets its first Showcase site in the store plan (decision 9).
 */
export function effectivePaise(line: BillingLine, all: readonly BillingLine[], at = Date.now(), on: OnBill = chargedAt): number {
  if (line.kind === 'showcase_site' && includedSite(all, at, on)?.id === line.id) return 0
  const changes = ms(line.changesAt)
  return line.nextAmountPaise != null && changes != null && changes <= at ? line.nextAmountPaise : line.amountPaise
}

function includedSite(all: readonly BillingLine[], at: number, on: OnBill): BillingLine | undefined {
  if (!all.some(l => l.kind === 'store_plan' && on(l, at))) return undefined
  return all.filter(l => l.kind === 'showcase_site' && on(l, at)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]
}

/**
 * Whether a charge at `at` covers this line: active and awaiting ones, an ending one until it ends, a trial once it
 * has ended. Legacy wallet lines are not on a subscription until migrated.
 */
export function chargedAt(line: BillingLine, at = Date.now()): boolean {
  if (line.status === 'active' || line.status === 'awaiting_payment') return true
  if (line.status === 'ending') return (ms(line.endsAt) ?? 0) > at
  if (line.status === 'trial') return (ms(line.trialEndsAt) ?? Infinity) <= at + DAY_MS
  return false
}

export function monthlyTotal(lines: readonly BillingLine[], at = Date.now(), on: OnBill = chargedAt): number {
  return lines.filter(l => on(l, at)).reduce((n, l) => n + effectivePaise(l, lines, at, on), 0)
}

/**
 * Upfront proration for an increase: the monthly difference over what is left of the current cycle, at the
 * current cycle's interval. Never negative; a decrease takes effect at cycle end with no mid-cycle refund.
 */
export function prorationPaise(o: { monthlyDeltaPaise: number; interval: BillingInterval; from: number; cycleStart: number; cycleEnd: number }): number {
  if (o.monthlyDeltaPaise <= 0 || o.cycleEnd <= o.cycleStart) return 0
  const left = Math.min(Math.max(o.cycleEnd - o.from, 0), o.cycleEnd - o.cycleStart)
  return Math.round((cyclePaise(o.monthlyDeltaPaise, o.interval) * left) / (o.cycleEnd - o.cycleStart))
}

export type PaymentMethod = 'upi' | 'card' | 'emandate'
/** Above the mandate limit (or its yearly 10×) only eMandate or a card can be used (decision 12). */
export const paymentMethodsFor = (cycle: number): PaymentMethod[] => (cycle > MANDATE_LIMIT_PAISE ? ['card', 'emandate'] : ['upi', 'card', 'emandate'])

export const LINE_LABEL: Record<LineKind, string> = {
  store_plan: 'Store plan',
  showcase_site: 'Showcase site',
  messaging_addon: 'SMS & WhatsApp add-on',
  ad_free: 'Ad-free store',
}

/** Store-only add-ons: they end with the store. */
export const STORE_ONLY: readonly LineKind[] = ['store_plan', 'messaging_addon', 'ad_free']

/** The current monthly price of a new line (decision 11: existing lines keep the price they were added at). */
export async function listPricePaise(kind: LineKind, tenantId: string): Promise<number> {
  if (kind === 'showcase_site') return SHOWCASE_PRICE_INR * 100
  if (kind === 'ad_free') return AD_FREE_PRICE_INR * 100
  if (kind === 'messaging_addon') return (await getMessagingAddonPricing()).priceInr * 100
  const r = await controlPlanePool().query<{ price: string | null; fee: string | null }>(
    `SELECT c.price_inr_month AS price, p.monthly_price_inr AS fee FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
       LEFT JOIN tenant_compute c ON c.tenant_id = t.id WHERE t.id = $1`,
    [tenantId]
  )
  return Math.round(Number(r.rows[0]?.price ?? r.rows[0]?.fee ?? 0) * 100)
}

/** Labels for a workspace's lines: the store's plan name and each site's address. */
export async function lineLabels(tenantId: string, lines: readonly Pick<BillingLine, 'kind' | 'ref'>[]): Promise<(l: Pick<BillingLine, 'kind' | 'ref'>) => string> {
  const pool = controlPlanePool()
  const siteIds = lines.filter(l => l.kind === 'showcase_site' && /^[0-9a-f-]{36}$/i.test(l.ref)).map(l => l.ref)
  const [plan, sites] = await Promise.all([
    lines.some(l => l.kind === 'store_plan')
      ? pool.query<{ name: string | null }>(`SELECT p.name FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`, [tenantId]).catch(() => ({ rows: [] as { name: string | null }[] }))
      : Promise.resolve({ rows: [] as { name: string | null }[] }),
    siteIds.length
      ? pool.query<{ id: string; slug: string }>(`SELECT id::text, slug FROM showcase_sites WHERE id = ANY($1::uuid[])`, [siteIds]).catch(() => ({ rows: [] as { id: string; slug: string }[] }))
      : Promise.resolve({ rows: [] as { id: string; slug: string }[] }),
  ])
  const hosts = new Map(sites.rows.map(s => [s.id, showcaseHost(s.slug)]))
  const planName = plan.rows[0]?.name
  return l =>
    l.kind === 'store_plan' ? `${planName ?? 'Store'} plan` : l.kind === 'showcase_site' ? `Showcase site ${hosts.get(l.ref) ?? ''}`.trim() : LINE_LABEL[l.kind]
}

export async function snapshot(tenantId: string, lines: readonly BillingLine[], at = Date.now(), on: OnBill = chargedAt): Promise<SnapshotLine[]> {
  const charged = lines.filter(l => on(l, at))
  const label = await lineLabels(tenantId, charged)
  return charged.map(l => ({ kind: l.kind, ref: l.ref, label: label(l), amountPaise: effectivePaise(l, lines, at, on) }))
}

// ── Reads and writes ─────────────────────────────────────────────────────────

type Q = Pick<PoolClient, 'query'>
const q = (c?: Q): Q => c ?? controlPlanePool()

export async function listLines(tenantId: string, opts: { includeEnded?: boolean; client?: Q } = {}): Promise<BillingLine[]> {
  const r = await q(opts.client).query(
    `SELECT * FROM billing_lines WHERE tenant_id = $1 ${opts.includeEnded ? '' : `AND status <> 'ended'`} ORDER BY created_at, id`,
    [tenantId]
  )
  return r.rows.map(toLine)
}

export async function getOpenLine(tenantId: string, kind: LineKind, ref = '', client?: Q): Promise<BillingLine | null> {
  const r = await q(client).query(`SELECT * FROM billing_lines WHERE tenant_id = $1 AND kind = $2 AND ref = $3 AND status <> 'ended'`, [tenantId, kind, ref])
  return r.rows[0] ? toLine(r.rows[0]) : null
}

/** Opens a line unless one is already open for the same thing (then that one is returned). */
export async function openLine(
  input: { tenantId: string; kind: LineKind; ref?: string; amountPaise: number; status: LineStatus; trialEndsAt?: string | null; graceUntil?: string | null; legacyRef?: string | null },
  client?: Q
): Promise<BillingLine> {
  const r = await q(client).query(
    `INSERT INTO billing_lines (tenant_id, kind, ref, amount_paise, status, trial_ends_at, grace_until, legacy_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, kind, ref) WHERE status <> 'ended' DO NOTHING RETURNING *`,
    [input.tenantId, input.kind, input.ref ?? '', Math.round(input.amountPaise), input.status, input.trialEndsAt ?? null, input.graceUntil ?? null, input.legacyRef ?? null]
  )
  if (r.rows[0]) return toLine(r.rows[0])
  return (await getOpenLine(input.tenantId, input.kind, input.ref ?? '', client))!
}

/** A subscription nobody authorised: the lines it would have started end, and trials it would have covered wait again. */
export async function releaseUnstartedLines(subscriptionId: string, client?: Q): Promise<void> {
  await q(client).query(`UPDATE billing_lines SET status = 'ended', ends_at = now(), updated_at = now() WHERE subscription_id = $1 AND status = 'awaiting_payment'`, [subscriptionId])
  await q(client).query(`UPDATE billing_lines SET subscription_id = NULL, updated_at = now() WHERE subscription_id = $1 AND status = 'trial'`, [subscriptionId])
}

export async function patchLine(id: string, cols: Record<string, unknown>, client?: Q): Promise<void> {
  const keys = Object.keys(cols)
  if (!keys.length) return
  await q(client).query(`UPDATE billing_lines SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...keys.map(k => cols[k])])
}
