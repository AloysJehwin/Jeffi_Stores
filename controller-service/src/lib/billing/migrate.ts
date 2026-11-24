import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { creditWallet, type WalletCategory } from '@/lib/payments/wallet'
import { applyChange, currentSubscription, isPaying, quote, type ChangeResult, type Payer, type Quote } from './subscription'
import { listLines, type BillingLine, type LineKind } from './lines'

// Existing customers switch now (docs/plans/SUBSCRIPTION_BILLING_PLAN.md section 3). Wallet-paid add-ons and sites
// carry legacy_wallet lines (2026-12-01_billing_backfill.sql) that keep working until their grace_until; subscribing
// brings them onto the subscription, and the unused part of each wallet-paid month is credited back to the wallet.

export type BillingMode = 'wallet' | 'subscription'

export async function billingMode(): Promise<BillingMode> {
  const r = await controlPlanePool().query<{ value: string }>(`SELECT value FROM platform_infra WHERE key = 'billing_mode'`).catch(() => ({ rows: [] as { value: string }[] }))
  return r.rows[0]?.value === 'subscription' ? 'subscription' : 'wallet'
}

export async function cutoverAt(): Promise<string | null> {
  const r = await controlPlanePool().query<{ value: string }>(`SELECT value FROM platform_infra WHERE key = 'billing_cutover_at'`).catch(() => ({ rows: [] as { value: string }[] }))
  const v = r.rows[0]?.value
  return v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null
}

const CATEGORY: Record<LineKind, WalletCategory> = { showcase_site: 'showcase', ad_free: 'ad_free', messaging_addon: 'messaging_addon', store_plan: 'adjustment' }
const MONTH_MS = 30 * 86_400_000

/** credit = paid × (until − t) / (until − period_start), never below 0 or above what was paid. */
export function proratedCredit(paidInr: number, periodStart: number, until: number, t: number): number {
  if (!(paidInr > 0) || until <= periodStart || t >= until) return 0
  const share = Math.min(1, (until - Math.max(t, periodStart)) / (until - periodStart))
  return Math.round(paidInr * share * 100) / 100
}

/** The paid period a legacy line's wallet charge bought: what was paid, from when, until when. */
async function paidPeriod(line: BillingLine): Promise<{ paidInr: number; start: number; until: number } | null> {
  if (!line.legacyRef) return null
  const pool = controlPlanePool()
  const w = await pool.query<{ amount: string; occurred_at: string }>(
    `SELECT amount, occurred_at FROM wallet_ledger WHERE tenant_id = $1 AND external_ref = $2 AND entry_type = 'debit' LIMIT 1`,
    [line.tenantId, line.legacyRef]
  )
  if (!w.rows[0]) return null
  const paidInr = -Number(w.rows[0].amount)
  const untilSql =
    line.kind === 'showcase_site'
      ? `SELECT paid_until AS until FROM showcase_sites WHERE id::text = $1`
      : line.kind === 'ad_free'
        ? `SELECT ad_free_until AS until FROM tenants WHERE id = $1`
        : `SELECT messaging_addon_until AS until FROM tenants WHERE id = $1`
  const u = await pool.query<{ until: string | null }>(untilSql, [line.kind === 'showcase_site' ? line.ref : line.tenantId])
  const until = u.rows[0]?.until ? Date.parse(u.rows[0].until) : null
  if (!until) return null
  // Every wallet charge bought one month ending at the entitlement's end; its date key says when it started.
  const keyed = line.legacyRef.match(/(\d{4}-\d{2}-\d{2})$/)?.[1]
  const start = keyed ? Date.parse(keyed) : Math.min(until - MONTH_MS, Date.parse(w.rows[0].occurred_at))
  return { paidInr, start: Math.min(start, until - 1), until }
}

/** The credit owed for a legacy line if it moved onto the subscription at `t`. */
export async function legacyCredit(line: BillingLine, t = Date.now()): Promise<number> {
  const p = await paidPeriod(line)
  return p ? proratedCredit(p.paidInr, p.start, p.until, t) : 0
}

/** Credits the unused wallet-paid time of lines just moved onto the subscription. Idempotent on migrate:<ref>. */
export async function applyMigrationCredits(lines: readonly BillingLine[], t = Date.now()): Promise<number> {
  let total = 0
  for (const l of lines.filter(x => x.legacyRef)) {
    const amount = await legacyCredit(l, t).catch(() => 0)
    if (!(amount > 0)) continue
    const r = await creditWallet({
      tenantId: l.tenantId,
      amountInr: amount,
      category: CATEGORY[l.kind],
      externalRef: `migrate:${l.legacyRef}`,
      note: 'Unused wallet-paid time, moved to your subscription',
    })
    if (r.ok && r.credited) total += amount
  }
  return total
}

/** A workspace already paying on a subscription keeps its billing date (a replacement with proration); else it starts now. */
const immediate = async (tenantId: string) => !isPaying(await currentSubscription(tenantId).catch(() => null))

export interface MigrationQuote {
  legacy: BillingLine[]
  quote: Quote
  creditInr: number
  deadline: string | null
}

/** What /dashboard/billing/subscribe shows: everything billed after subscribing, the credit, the deadline. */
export async function migrationQuote(tenantId: string): Promise<MigrationQuote> {
  const lines = await listLines(tenantId)
  const legacy = lines.filter(l => l.status === 'legacy_wallet')
  const [qt, credits] = await Promise.all([quote(tenantId, { migrate: true, immediate: await immediate(tenantId) }), Promise.all(legacy.map(l => legacyCredit(l)))])
  const deadline = legacy.map(l => l.graceUntil).filter((d): d is string => !!d).sort()[0] ?? null
  return { legacy, quote: qt, creditInr: Math.round(credits.reduce((a, b) => a + b, 0) * 100) / 100, deadline }
}

/**
 * Subscribe a workspace with legacy lines. It starts now; one already paying (a store's plan) gets a replacement that
 * keeps its billing date, with the moved lines prorated upfront.
 */
export async function startMigration(tenantId: string, payer: Payer): Promise<ChangeResult> {
  return applyChange(tenantId, { migrate: true, immediate: await immediate(tenantId) }, payer)
}
