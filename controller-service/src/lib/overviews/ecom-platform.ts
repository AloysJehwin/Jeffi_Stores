import type { Pool } from 'pg'
import { delta, type Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'
import type { LineKind } from '@controller/lib/billing/lines'

// Shared SQL and maths for the platform (control-plane) overviews: ecom customers, billing,
// instances and store status. All of it reads the control-plane tables via controlPlanePool().

export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const IST = `'Asia/Kolkata'`

/** IST day bounds for $a..$b (inclusive days) on a timestamptz expression. */
export const inIst = (expr: string, a: number, b: number) =>
  `(${expr} >= ($${a}::date::timestamp AT TIME ZONE ${IST}) AND ${expr} < (($${b}::date + 1)::timestamp AT TIME ZONE ${IST}))`

/** Bucket start (IST date) for a timestamptz expression. */
export const istBucket = (expr: string, bucket: string) =>
  `date_trunc('${bucket}', (${expr} AT TIME ZONE ${IST}))::date`

/** Every bucket start from $a to $b, so empty buckets still chart. */
export const bucketSeries = (bucket: string, a: number, b: number) =>
  `SELECT generate_series(date_trunc('${bucket}', $${a}::date), $${b}::date, interval '1 ${bucket}')::date AS b`

// Monthly subscription price: tenant_compute.price_inr_month wins (set when the owner picked their spec);
// grandfathered stores (no tc row yet) fall back to plan.monthly_price_inr. Yearly billing is 10/12 of monthly.
export const PRICE_INR_MONTH_SQL = `COALESCE((SELECT tc.price_inr_month FROM tenant_compute tc WHERE tc.tenant_id = t.id), p.monthly_price_inr, 0)`

/** Monthly value of a store: yearly billing is ten months' price over twelve. */
export const MRR_SQL = `(CASE WHEN t.billing_interval = 'yearly' THEN ${PRICE_INR_MONTH_SQL} * 10 / 12 ELSE ${PRICE_INR_MONTH_SQL} END)`

/** The plan's margin for the store's database: rds_margin (when set) for a database on RDS, else infra_margin; else `fallback`. Needs t / p. */
export const planMarginSql = (fallback = '0') =>
  `COALESCE(CASE WHEN (SELECT COALESCE(tc.applied, tc.desired)->'db'->>'mode' FROM tenant_compute tc WHERE tc.tenant_id = t.id) = 'dedicated' THEN p.rds_margin END, p.infra_margin, ${fallback})`

// Price = plan fee (GST included) + infra × (1 + m) × (1 + GST). The fee net of GST is all margin; of the
// infra, m / (1 + m) of it net of GST is.
const PLAN_FEE_SQL = `COALESCE(p.monthly_price_inr, 0)`
const MARGIN_SQL = planMarginSql()
const MARGIN_MONTH_SQL = `(${PLAN_FEE_SQL}::numeric / 1.18 + GREATEST(${PRICE_INR_MONTH_SQL} - ${PLAN_FEE_SQL}, 0)::numeric / 1.18 * ${MARGIN_SQL} / (1 + ${MARGIN_SQL}))`

/** Platform margin earned (not due to AWS or GST) per month; yearly billing is ten months over twelve. */
export const INFRA_MARGIN_MRR_SQL = `(CASE WHEN t.billing_interval = 'yearly' THEN ${MARGIN_MONTH_SQL} * 10 / 12 ELSE ${MARGIN_MONTH_SQL} END)`

/** A tenant on a paid store plan (needs the tenants t / plans p aliases). */
export const PAID_STORE_SQL = `(p.product = 'store' AND ${PRICE_INR_MONTH_SQL} > 0 AND 'store' = ANY(t.service_types))`

/** Paying now: live store on a paid plan. */
export const PAYING_SQL = `(t.status = 'active' AND ${PAID_STORE_SQL})`

export const NOT_PLATFORM = `t.id <> '${PLATFORM_TENANT_ID}'`

// ── Workspace subscriptions (lib/billing): one Razorpay subscription per workspace ──────

export const BILLING_KINDS: readonly LineKind[] = ['store_plan', 'showcase_site', 'messaging_addon', 'ad_free']

/** Billing subscription statuses a workspace is paying on. */
export const BILLING_PAYING_SQL = `('authenticated', 'active', 'pending')`

/** The tenant (alias t) is billed on a workspace subscription, so its MRR comes from billing_subscriptions. */
export const HAS_BILLING_SQL = `EXISTS (SELECT 1 FROM billing_subscriptions bs WHERE bs.tenant_id = t.id AND bs.is_current)`

/** Monthly value in rupees of a billing subscription (alias b): a yearly one charges ten months, spread over twelve. */
export const BILLING_MRR_SQL = `(CASE WHEN b.billing_interval = 'yearly' THEN b.amount_paise::numeric / 12 ELSE b.amount_paise::numeric END / 100)`

const LINES_ARRAY = (col: string) => `jsonb_array_elements(CASE WHEN jsonb_typeof(${col}) = 'array' THEN ${col} ELSE '[]'::jsonb END)`
const LINE_PAISE = `COALESCE((e->>'amountPaise')::numeric, 0)`

/** Each line (alias e) of a billing subscription's (alias b) lines snapshot. */
export const BILLING_LINES_SQL = `CROSS JOIN LATERAL ${LINES_ARRAY('b.lines')} e`

/** Monthly value in rupees of a snapshot line (alias e) on billing subscription b. */
export const BILLING_LINE_MRR_SQL = `(CASE WHEN b.billing_interval = 'yearly' THEN ${LINE_PAISE} * 10 / 12 ELSE ${LINE_PAISE} END / 100)`

// A legacy settlement row is a charge from before billing_charges: one not matched by a billing charge.
const LEGACY_CHARGE = `l.entry_type = 'subscription_charge' AND NOT EXISTS (SELECT 1 FROM billing_charges bc WHERE bc.razorpay_payment_id = l.external_ref)`

/**
 * Collected subscription revenue, one row per charge: tenant_id, at, amount and refunded (rupees, amount net of
 * refunds). billing_charges since the switch, settlement_ledger subscription_charge rows before it.
 */
export const SUBSCRIPTION_CHARGES_SQL = `
SELECT ch.tenant_id, ch.charged_at AS at, (ch.amount_paise - ch.refunded_paise)::numeric / 100 AS amount, ch.refunded_paise::numeric / 100 AS refunded
  FROM billing_charges ch WHERE ch.amount_paise > 0
UNION ALL
SELECT l.tenant_id, l.occurred_at, -l.amount, 0 FROM settlement_ledger l WHERE ${LEGACY_CHARGE}`

/**
 * The same revenue by line kind (at, kind, amount): a charge is split over its lines snapshot in proportion to
 * their price; a legacy settlement row was a store plan charge.
 */
export const SUBSCRIPTION_CHARGE_KINDS_SQL = `
SELECT ch.charged_at AS at, COALESCE(x.kind, 'other') AS kind,
       (ch.amount_paise - ch.refunded_paise)::numeric / 100
         * CASE WHEN x.total > 0 THEN x.paise / x.total WHEN x.n > 0 THEN 1.0 / x.n ELSE 1 END AS amount
  FROM billing_charges ch
  LEFT JOIN LATERAL (
    SELECT e->>'kind' AS kind, ${LINE_PAISE} AS paise, SUM(${LINE_PAISE}) OVER () AS total, count(*) OVER () AS n
      FROM ${LINES_ARRAY('ch.lines')} e
  ) x ON true
 WHERE ch.amount_paise > 0
UNION ALL
SELECT l.occurred_at, 'store_plan', -l.amount FROM settlement_ledger l WHERE ${LEGACY_CHARGE}`

export const periodParams = (cur: Period, prev: Period) => [cur.from, cur.to, prev.from, prev.to]

export const num = (v: unknown) => (v == null ? 0 : Number(v) || 0)
export const numOrNull = (v: unknown) => (v == null ? null : Number(v))

/** Monthly recurring value of one subscription. */
export function monthlyValue(monthlyPrice: number, interval: string | null | undefined): number {
  const p = Number(monthlyPrice) || 0
  return interval === 'yearly' ? (p * 10) / 12 : p
}

export interface MrrMovement {
  new_mrr: number
  churned_mrr: number
  net_new_mrr: number
}

export function mrrMovement(newMrr: number, churnedMrr: number): MrrMovement {
  const n = round2(newMrr)
  const c = round2(churnedMrr)
  return { new_mrr: n, churned_mrr: c, net_new_mrr: round2(n - c) }
}

/** Share of MRR lost in the period against the MRR at its start (current + churned - new). */
export function mrrChurnRate(mrr: number, newMrr: number, churnedMrr: number): number | null {
  const start = mrr + churnedMrr - newMrr
  return start > 0 ? churnedMrr / start : null
}

export const round2 = (v: number) => Math.round(v * 100) / 100

/** Next charge date: last charge plus one billing interval (YYYY-MM-DD). */
export function nextRenewal(lastCharge: string, interval: string | null | undefined): string {
  const d = new Date(lastCharge)
  if (interval === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}

export const STORAGE_WARN = 0.8

export function storageUse(used: number, quota: number): number | null {
  return quota > 0 ? used / quota : null
}

// Wallet ledger categories. Rows without a category read as their entry_type.
const MESSAGING = new Set(['sms', 'whatsapp', 'email', 'media', 'rcs', 'voice', 'campaign'])

export interface WalletMix {
  topups: number
  topup_count: number
  messaging: number
  documents: number
  shipping: number
  /** Servers (category infra). */
  infra: number
  other: number
}

/** Fold signed wallet_ledger sums by category into top-ups and usage revenue (positive numbers). */
export function walletMix(
  rows: { category: string | null; entry_type: string; amount: number; n?: number }[]
): WalletMix {
  const m: WalletMix = { topups: 0, topup_count: 0, messaging: 0, documents: 0, shipping: 0, infra: 0, other: 0 }
  for (const r of rows) {
    const amt = Number(r.amount) || 0
    const cat = r.category || r.entry_type
    if (r.entry_type === 'recharge') {
      m.topups += amt
      m.topup_count += Number(r.n) || 0
    } else if (r.entry_type === 'debit') {
      const v = -amt
      if (MESSAGING.has(cat)) m.messaging += v
      else if (cat === 'document') m.documents += v
      else if (cat === 'infra') m.infra += v
      else if (cat.startsWith('shipping')) m.shipping += v
      else m.other += v
    } else if (cat.startsWith('shipping')) m.shipping -= amt
  }
  for (const k of Object.keys(m) as (keyof WalletMix)[]) m[k] = round2(m[k])
  return m
}

export interface KindRevenue {
  kind: LineKind | 'other'
  mrr: number
  collected: number
  previous: number
  delta: number | null
  /** Open billing lines: active (incl. ending), in trial, awaiting a first charge, still paid from the wallet. */
  lines: { active: number; trial: number; awaiting: number; legacy: number }
}

const LINE_STATE: Record<string, keyof KindRevenue['lines']> = { active: 'active', ending: 'active', trial: 'trial', awaiting_payment: 'awaiting', legacy_wallet: 'legacy' }

/** One row per line kind; 'other' (a charge without a lines snapshot) only when it collected something. */
export function billingByKind(o: {
  mrr: Record<string, number>
  collected: Record<string, number>
  previous: Record<string, number>
  lines: { kind: string; status: string; n: number }[]
}): KindRevenue[] {
  const kinds: (LineKind | 'other')[] = [...BILLING_KINDS, ...(o.collected.other || o.previous.other ? ['other' as const] : [])]
  return kinds.map(kind => {
    const lines = { active: 0, trial: 0, awaiting: 0, legacy: 0 }
    for (const l of o.lines) if (l.kind === kind && LINE_STATE[l.status]) lines[LINE_STATE[l.status]] += Number(l.n) || 0
    const collected = round2(o.collected[kind] ?? 0)
    const previous = round2(o.previous[kind] ?? 0)
    return { kind, mrr: round2(o.mrr[kind] ?? 0), collected, previous, delta: delta(collected, previous), lines }
  })
}

// ── Needs attention (shared across the four platform pages) ─────────────────────────────

export type PlatformArea = 'customers' | 'billing' | 'instances' | 'store-status'

interface AttentionKind {
  severity: AttentionItem['severity']
  areas: PlatformArea[]
  title: (n: number) => string
  href: (single: { id: string } | null) => string
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const tenantHref = (tab?: string) => (one: { id: string } | null) =>
  one ? `/admin/ecom/customers/${one.id}/view${tab ? `?tab=${tab}` : ''}` : '/admin/ecom/customers?tab=list'

export const ATTENTION_KINDS: Record<string, AttentionKind> = {
  failed_payment: {
    severity: 'critical',
    areas: ['customers', 'billing'],
    title: n => `${plural(n, 'store')} with a failed subscription payment (halted)`,
    href: one => (one ? `/admin/ecom/billing/${one.id}/view` : '/admin/ecom/billing?tab=list'),
  },
  store_down: {
    severity: 'critical',
    areas: ['customers', 'store-status', 'instances'],
    title: n => `${plural(n, 'live store')} with the instance stopped`,
    href: one => (one ? `/admin/ecom/store-status/${one.id}/view` : '/admin/ecom/store-status?tab=list'),
  },
  servers_paused: {
    severity: 'warning',
    areas: ['customers', 'billing', 'store-status'],
    title: n => `${plural(n, 'store')} paused for an unpaid server balance`,
    href: one => (one ? `/admin/ecom/billing/${one.id}/view` : '/admin/ecom/billing?tab=list'),
  },
  servers_grace: {
    severity: 'info',
    areas: ['billing'],
    title: n => `${plural(n, 'wallet')} below zero, running on grace before a pause`,
    href: one => (one ? `/admin/ecom/billing/${one.id}/view` : '/admin/ecom/billing?tab=list'),
  },
  provisioning_failed: {
    severity: 'critical',
    areas: ['customers', 'instances'],
    title: n => `${plural(n, 'store')} with failed provisioning`,
    href: tenantHref('provisioning'),
  },
  provisioning_stuck: {
    severity: 'warning',
    areas: ['customers', 'instances'],
    title: n => `${plural(n, 'provisioning job')} stuck for over 30 minutes`,
    href: tenantHref('provisioning'),
  },
  migration_failed: {
    severity: 'warning',
    areas: ['instances', 'store-status'],
    title: n => `${plural(n, 'store')} whose last schema release failed`,
    href: one => (one ? `/admin/ecom/instances/${one.id}/view` : '/admin/ecom/instances?tab=list'),
  },
  storage_near_quota: {
    severity: 'warning',
    areas: ['customers', 'instances'],
    title: n => `${plural(n, 'store')} at ${Math.round(STORAGE_WARN * 100)}% or more of the storage quota`,
    href: one => (one ? `/admin/ecom/instances/${one.id}/view` : '/admin/ecom/instances?tab=list'),
  },
  service_approval: {
    severity: 'warning',
    areas: ['customers'],
    title: n => `${plural(n, 'API workspace')} waiting for Messaging or Documents approval`,
    href: tenantHref(),
  },
  pending_approval: {
    severity: 'warning',
    areas: ['customers'],
    title: n => `${plural(n, 'store application')} waiting for approval`,
    href: tenantHref(),
  },
  kyc_pending: {
    severity: 'warning',
    areas: ['customers'],
    title: n => `${plural(n, 'KYC submission')} to review`,
    href: tenantHref(),
  },
  awaiting_payment: {
    severity: 'info',
    areas: ['customers', 'billing'],
    title: n => `${plural(n, 'approved store')} not paid after 3 days`,
    href: tenantHref(),
  },
  wallet_low: {
    severity: 'info',
    areas: ['billing'],
    title: n => `${plural(n, 'wallet')} below the minimum balance`,
    href: one => (one ? `/admin/ecom/billing/${one.id}/view` : '/admin/ecom/billing?tab=list'),
  },
  domain_failed: {
    severity: 'warning',
    areas: ['store-status'],
    title: n => `${plural(n, 'custom domain')} failed verification`,
    href: tenantHref(),
  },
  cert_expiring: {
    severity: 'warning',
    areas: ['store-status'],
    title: n => `${plural(n, 'store certificate')} expiring within 14 days`,
    href: one => (one ? `/admin/ecom/store-status/${one.id}/view` : '/admin/ecom/store-status?tab=list'),
  },
}

/** One row per (kind, tenant) that needs the operator. Read-only. */
export const ATTENTION_SQL = `
WITH t AS (
  SELECT t.* FROM tenants t WHERE ${NOT_PLATFORM}
),
latest_job AS (
  SELECT DISTINCT ON (tenant_id) tenant_id, status, updated_at, step
  FROM provisioning_jobs ORDER BY tenant_id, created_at DESC
),
latest_mig AS (
  SELECT DISTINCT ON (tenant_id) tenant_id, status
  FROM tenant_migration_runs ORDER BY tenant_id, ran_at DESC
)
SELECT 'failed_payment' AS kind, t.id, t.display_name AS name FROM t WHERE t.subscription_status = 'halted' AND t.status <> 'terminated'
UNION ALL
SELECT 'store_down', t.id, t.display_name FROM t WHERE t.status = 'active' AND 'store' = ANY(t.service_types) AND t.instance_state NOT IN ('running', 'paused')
UNION ALL
SELECT 'servers_paused', t.id, t.display_name FROM t WHERE t.status = 'active' AND t.instance_state = 'paused'
UNION ALL
SELECT 'servers_grace', t.id, t.display_name FROM t JOIN tenant_compute c ON c.tenant_id = t.id WHERE t.status = 'active' AND c.low_balance_since IS NOT NULL AND c.status <> 'paused'
UNION ALL
SELECT 'provisioning_failed', t.id, t.display_name FROM t JOIN latest_job j ON j.tenant_id = t.id WHERE j.status = 'failed' AND t.status = 'provisioning'
UNION ALL
SELECT 'provisioning_stuck', t.id, t.display_name FROM t JOIN latest_job j ON j.tenant_id = t.id WHERE j.status IN ('pending', 'running') AND j.updated_at < now() - interval '30 minutes'
UNION ALL
SELECT 'migration_failed', t.id, t.display_name FROM t JOIN latest_mig m ON m.tenant_id = t.id WHERE m.status = 'failed' AND t.status = 'active'
UNION ALL
SELECT 'storage_near_quota', t.id, t.display_name FROM t JOIN tenant_infra i ON i.tenant_id = t.id JOIN plans p ON p.id = t.plan_id
 WHERE t.status = 'active' AND p.storage_quota_bytes > 0 AND i.used_storage_bytes >= p.storage_quota_bytes * ${STORAGE_WARN}
UNION ALL
SELECT DISTINCT 'service_approval', t.id, t.display_name FROM t JOIN tenant_service_approvals a ON a.tenant_id = t.id WHERE a.status = 'pending'
UNION ALL
SELECT 'pending_approval', t.id, t.display_name FROM t WHERE t.status = 'pending_approval' OR t.store_request = 'pending_approval'
UNION ALL
SELECT 'kyc_pending', t.id, t.display_name FROM t JOIN tenant_kyc k ON k.tenant_id = t.id WHERE k.status = 'pending' AND t.status NOT IN ('rejected', 'terminated')
UNION ALL
SELECT 'awaiting_payment', t.id, t.display_name FROM t WHERE (t.status = 'awaiting_payment' OR t.store_request = 'awaiting_payment') AND t.updated_at < now() - interval '3 days'
UNION ALL
SELECT 'wallet_low', t.id, t.display_name FROM t JOIN tenant_wallets w ON w.tenant_id = t.id WHERE t.status = 'active' AND w.min_balance > 0 AND w.balance < w.min_balance
UNION ALL
SELECT 'domain_failed', t.id, t.display_name FROM t JOIN tenant_custom_domains d ON d.tenant_id = t.id WHERE d.status = 'failed' AND t.status = 'active'
UNION ALL
SELECT DISTINCT 'cert_expiring', t.id, t.display_name FROM t
  LEFT JOIN tenant_ca ca ON ca.tenant_id = t.id
  WHERE t.status = 'active' AND (
    ca.expires_at < now() + interval '14 days'
    OR EXISTS (SELECT 1 FROM tenant_admin_certs c WHERE c.tenant_id = t.id AND c.revoked_at IS NULL AND c.expires_at < now() + interval '14 days')
  )`

export interface AttentionRow {
  kind: string
  id: string
  name: string
}

/** Group attention rows by kind into one item each, for the given page. */
export function buildAttention(rows: AttentionRow[], area: PlatformArea): AttentionItem[] {
  const byKind = new Map<string, AttentionRow[]>()
  for (const r of rows) {
    if (!ATTENTION_KINDS[r.kind]?.areas.includes(area)) continue
    byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r])
  }
  const order = { critical: 0, warning: 1, info: 2 }
  return [...byKind.entries()]
    .map(([kind, list]) => {
      const k = ATTENTION_KINDS[kind]
      const names = list
        .slice(0, 3)
        .map(x => x.name)
        .join(', ')
      return {
        key: kind,
        severity: k.severity,
        title: k.title(list.length),
        sub: list.length > 3 ? `${names} and ${list.length - 3} more` : names,
        href: k.href(list.length === 1 ? list[0] : null),
      }
    })
    .sort((a, b) => order[a.severity] - order[b.severity])
}

export async function platformAttention(pool: Pool, area: PlatformArea): Promise<AttentionItem[]> {
  const r = await pool.query<AttentionRow>(ATTENTION_SQL)
  return buildAttention(r.rows, area)
}
