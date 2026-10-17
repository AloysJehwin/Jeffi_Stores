import type { Pool } from 'pg'
import type { Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'

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

/** Monthly value of a plan: yearly billing is ten months' price over twelve. */
export const MRR_SQL = `(CASE WHEN t.billing_interval = 'yearly' THEN p.monthly_price_inr * 10 / 12 ELSE COALESCE(p.monthly_price_inr, 0) END)`

/** A tenant on a paid store plan (needs the tenants t / plans p aliases). */
export const PAID_STORE_SQL = `(p.product = 'store' AND p.monthly_price_inr > 0 AND 'store' = ANY(t.service_types))`

/** Paying now: live store on a paid plan. */
export const PAYING_SQL = `(t.status = 'active' AND ${PAID_STORE_SQL})`

export const NOT_PLATFORM = `t.id <> '${PLATFORM_TENANT_ID}'`

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
  other: number
}

/** Fold signed wallet_ledger sums by category into top-ups and usage revenue (positive numbers). */
export function walletMix(
  rows: { category: string | null; entry_type: string; amount: number; n?: number }[]
): WalletMix {
  const m: WalletMix = { topups: 0, topup_count: 0, messaging: 0, documents: 0, shipping: 0, other: 0 }
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
      else if (cat.startsWith('shipping')) m.shipping += v
      else m.other += v
    } else if (cat.startsWith('shipping')) m.shipping -= amt
  }
  for (const k of Object.keys(m) as (keyof WalletMix)[]) m[k] = round2(m[k])
  return m
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
SELECT 'store_down', t.id, t.display_name FROM t WHERE t.status = 'active' AND 'store' = ANY(t.service_types) AND t.instance_state <> 'running'
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
