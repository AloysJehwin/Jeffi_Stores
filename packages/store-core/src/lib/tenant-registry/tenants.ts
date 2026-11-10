import { controlPlanePool, RESERVED_LABELS } from './shared'
import { TENANT_HOST_PREFIXES } from './host-prefixes'
import { clearTenantCache } from './host-resolution'
import type { ComputeSpec } from '@/lib/compute/spec'

/** The platform admin's UPI switch for a store: 'auto' = its own provider (PhonePe when saved, else UPG), 'off' = none. */
export type UpiMode = 'auto' | 'off'
export const UPI_MODES: UpiMode[] = ['auto', 'off']

export interface TenantRow {
  id: string
  slug: string
  custom_domain: string | null
  display_name: string
  status: string
  plan: string | null
  monthly_price_inr: string | null
  max_custom_domains: number
  daily_payout: boolean
  own_delhivery: boolean
  own_razorpay: boolean
  upi_mode: UpiMode
  service_types: string[] // store | messaging | documents
  store_request?: StoreRequest | null
  billing_interval: string
  /** A downgrade waiting for the paid cycle to end (owner queries only). */
  pending_plan?: string | null
  pending_billing_interval?: string | null
  razorpay_subscription_id: string | null
  razorpay_checkout_url: string | null
  razorpay_linked_account_id: string | null
  subscription_status: string
  noreply_email: string
  campaign_email: string
  rds_endpoint: string | null
  s3_bucket: string | null
  ec2_target: string | null
  region: string | null
  created_at: string
}

/** A store or workspace waiting on Jeffi: store KYC or a requested Messaging/Documents service. */
const NEEDS_REVIEW_SQL = `(EXISTS (SELECT 1 FROM tenant_kyc k WHERE k.tenant_id = t.id AND k.status = 'pending') OR EXISTS (SELECT 1 FROM tenant_service_approvals a WHERE a.tenant_id = t.id AND a.status = 'pending'))`
const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

/** A listTenants row: the tenant plus what it runs, its wallet, owner, latest provisioning job and 30-day sales. */
export interface TenantListRow extends TenantRow {
  instance_state: string
  ec2_instance_id: string | null
  /** The plan's margin for the store's database (plans.rds_margin on RDS when set, else infra_margin); null when the plan has none (the catalog margin applies). */
  infra_margin: number | null
  /** tenant_compute.applied as stored (normalizeSpec before use); null until compute is applied. */
  applied: ComputeSpec | null
  /** Subscription price (plan fee + infra + GST) in rupees; null when the store has none. */
  price_inr_month: number | null
  rate_inr_hour: number | null
  /** ISO timestamp. */
  applied_at: string | null
  /** tenant_compute.status: pending | applying | applied | failed | paused | scheduled. */
  compute_status: string | null
  wallet_balance: number | null
  owner_email: string | null
  needs_review: boolean
  job_status: string | null
  job_step: string | null
  job_error: string | null
  /** ISO timestamp. */
  job_updated_at: string | null
  s3_usage_bytes: number | null
  gmv_30d: number
  commission_30d: number
}

/** List tenants (control-plane admin UI). Read-only, optional filters. */
export async function listTenants(filters?: { status?: string; plan?: string; q?: string; product?: 'store' | 'api' }): Promise<TenantListRow[]> {
  const pool = controlPlanePool()
  const where: string[] = []
  const args: any[] = []
  if (filters?.status === 'review') where.push(NEEDS_REVIEW_SQL)
  else if (filters?.status) {
    args.push(filters.status)
    where.push(`t.status = $${args.length}`)
  }
  // 'store' = has a store; 'api' = Messaging/Documents-only workspace (no store infrastructure).
  if (filters?.product === 'store') where.push(`'store' = ANY(t.service_types)`)
  if (filters?.product === 'api') where.push(`NOT ('store' = ANY(t.service_types))`)
  if (filters?.plan) {
    args.push(filters.plan)
    where.push(`p.slug = $${args.length}`)
  }
  if (filters?.q) {
    args.push(`%${filters.q.toLowerCase()}%`)
    where.push(`(lower(t.display_name) LIKE $${args.length} OR lower(t.slug) LIKE $${args.length})`)
  }
  const res = await pool.query(
    `SELECT t.id, t.slug, (SELECT string_agg(cd.domain, ', ' ORDER BY cd.created_at) FROM tenant_custom_domains cd WHERE cd.tenant_id = t.id AND cd.status = 'verified') AS custom_domain, t.display_name, t.status, t.daily_payout, t.own_delhivery, t.own_razorpay, t.upi_mode, t.service_types, t.store_request, t.created_at,
            t.instance_state, t.billing_interval, t.subscription_status,
            p.slug AS plan, p.monthly_price_inr, COALESCE(CASE WHEN COALESCE(tc.applied, tc.desired)->'db'->>'mode' = 'dedicated' THEN p.rds_margin END, p.infra_margin)::float8 AS infra_margin,
            i.rds_endpoint, i.s3_bucket, i.ec2_target, i.ec2_instance_id, i.region, i.s3_usage_bytes::float8 AS s3_usage_bytes,
            tc.applied, tc.price_inr_month, tc.rate_inr_hour::float8 AS rate_inr_hour, ${ISO('tc.applied_at')} AS applied_at, tc.status AS compute_status,
            w.balance::float8 AS wallet_balance,
            (SELECT o.email FROM owner_tenants ot JOIN owners o ON o.id = ot.owner_id WHERE ot.tenant_id = t.id ORDER BY (ot.role = 'owner') DESC, ot.created_at LIMIT 1) AS owner_email,
            ${NEEDS_REVIEW_SQL} AS needs_review,
            pj.status AS job_status, pj.step AS job_step, pj.last_error AS job_error, ${ISO('pj.updated_at')} AS job_updated_at,
            COALESCE(tx.gmv, 0)::float8 AS gmv_30d, COALESCE(tx.commission, 0)::float8 AS commission_30d
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     LEFT JOIN tenant_compute tc ON tc.tenant_id = t.id
     LEFT JOIN tenant_wallets w ON w.tenant_id = t.id
     LEFT JOIN LATERAL (SELECT j.status, j.step, j.last_error, j.updated_at FROM provisioning_jobs j WHERE j.tenant_id = t.id ORDER BY j.created_at DESC LIMIT 1) pj ON true
     LEFT JOIN (SELECT x.tenant_id, SUM(x.gross_amount) AS gmv, SUM(x.platform_commission) AS commission FROM tenant_transactions x WHERE x.occurred_at > now() - interval '30 days' GROUP BY x.tenant_id) tx ON tx.tenant_id = t.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.created_at DESC`,
    args
  )
  return res.rows as TenantListRow[]
}

/** Store plans for filters, in tier order (inactive ones too: stores can still be on them). */
export async function planSlugs(): Promise<{ slug: string; name: string; active: boolean }[]> {
  const res = await controlPlanePool().query(`SELECT slug, name, is_active AS active FROM plans WHERE product = 'store' ORDER BY tier`)
  return res.rows
}

/** Summary counts for the control-plane dashboard. */
export async function tenantSummary(): Promise<{ total: number; active: number; mrr: number }> {
  const pool = controlPlanePool()
  // MRR: per-store subscription price from tenant_compute.price_inr_month (grandfathered stores fall back to plan fee);
  // yearly billing charges ten months a year, so its monthly value is 10/12 of that.
  const res = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE t.status='active')::int AS active,
            COALESCE(SUM(COALESCE(tc.price_inr_month, p.monthly_price_inr, 0) * CASE WHEN t.billing_interval = 'yearly' THEN 10.0 / 12 ELSE 1 END) FILTER (WHERE t.status='active'), 0)::numeric AS mrr
     FROM tenants t
       LEFT JOIN plans p ON p.id = t.plan_id
       LEFT JOIN tenant_compute tc ON tc.tenant_id = t.id`
  )
  const r = res.rows[0]
  return { total: r.total, active: r.active, mrr: Number(r.mrr) }
}

/** Count of active tenants — the sole input to pool auto-scaling (see pool-autoscale.ts). */
export async function activeTenantCount(): Promise<number> {
  const pool = controlPlanePool()
  const res = await pool.query(`SELECT count(*)::int AS n FROM tenants WHERE status='active'`)
  return res.rows[0].n
}

// Valid tenant slug: 3-63 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/
export interface CreateTenantInput {
  slug: string
  displayName: string
  planSlug: string
  billingInterval?: string
  dailyPayout?: boolean
  ownDelhivery?: boolean
  ownRazorpay?: boolean
  status?: string
  serviceTypes?: string[]
  warehouse?: {
    originPincode?: string
    pickupLocation?: string
    sellerName?: string
    sellerAddress?: string
    sellerPhone?: string
  }
}

export type CreateTenantResult = { ok: true; tenantId: string; slug: string } | { ok: false; error: string }

/**
 * Create a tenant in the control-plane registry (status='provisioning'). Validates
 * the slug (format + reserved-word + uniqueness) and the plan. Does NOT provision
 * any AWS infra — that's the separate provisioning engine; a tenant_infra row is
 * created empty and filled in when infra is stood up.
 */
export async function createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
  const slug = (input.slug || '').toLowerCase().trim()
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      error: 'Slug must be 3-63 chars, lowercase letters/numbers/hyphens, no leading/trailing hyphen.',
    }
  }
  if (RESERVED_LABELS.has(slug) || TENANT_HOST_PREFIXES.some(p => slug.startsWith(`${p}-`))) {
    return { ok: false, error: `"${slug}" is reserved and cannot be used as a store subdomain.` }
  }
  if (!input.displayName?.trim()) return { ok: false, error: 'Store name is required.' }

  const pool = controlPlanePool()
  const plan = await pool.query(`SELECT id FROM plans WHERE slug = $1 AND is_active = true`, [input.planSlug])
  if (!plan.rows[0]) return { ok: false, error: `Unknown or inactive plan "${input.planSlug}".` }

  const dup = await pool.query(`SELECT 1 FROM tenants WHERE slug = $1`, [slug])
  if (dup.rows[0]) return { ok: false, error: `Subdomain "${slug}" is already taken.` }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const t = await client.query(
      `INSERT INTO tenants (slug, display_name, plan_id, status, billing_interval, daily_payout, own_delhivery, own_razorpay, service_types)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        slug,
        input.displayName.trim(),
        plan.rows[0].id,
        input.status ?? 'provisioning',
        input.billingInterval ?? 'monthly',
        !!input.dailyPayout,
        !!input.ownDelhivery,
        !!input.ownRazorpay,
        input.serviceTypes?.length ? input.serviceTypes : ['store'],
      ]
    )
    const tenantId = t.rows[0].id
    // Empty infra row (rds_endpoint null → resolver returns tenant with null infra →
    // default pool) until the provisioning engine fills it in.
    await client.query(`INSERT INTO tenant_infra (tenant_id, s3_bucket) VALUES ($1, $2)`, [
      tenantId,
      `jeffi-tenant-${slug}`,
    ])
    // Welcome wallet credit so a new store can send messages immediately. Idempotent via external_ref.
    await client.query(
      `INSERT INTO tenant_wallets (tenant_id, balance) VALUES ($1, 100) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId]
    )
    await client.query(
      `INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, external_ref, note)
       VALUES ($1, 'recharge', 'recharge', 100, $2, 'Welcome wallet credit')
       ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING`,
      [tenantId, `signup_credit:${tenantId}`]
    )
    await client.query('COMMIT')
    clearTenantCache()
    return { ok: true, tenantId, slug }
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {})
    return { ok: false, error: e?.message || 'Failed to create tenant.' }
  } finally {
    client.release()
  }
}

/** Plan distribution across tenants (for the plan-mix chart). */
export async function planMix(): Promise<{ plan: string; count: number }[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT COALESCE(p.slug,'none') AS plan, count(*)::int AS count
     FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
     WHERE t.status <> 'terminated'
     GROUP BY p.slug ORDER BY count DESC`
  )
  return res.rows
}

/** List active plans for the onboarding UI. */
/** Active plans; the store lineup unless `any` (which adds the services workspace plan). */
export async function listPlans(product: 'store' | 'any' = 'store'): Promise<
  Array<{ slug: string; name: string; tier: number; monthly_price_inr: string }>
> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT slug, name, tier, monthly_price_inr FROM plans
      WHERE is_active = true ${product === 'store' ? `AND product = 'store'` : ''} ORDER BY tier`
  )
  return res.rows
}

export interface TenantDetail extends TenantRow {
  rds_db: string | null
  rds_port: number | null
  rds_user: string | null
  shared_db_host: string | null
  iam_auth: boolean | null
  cloudfront_id: string | null
  instance_state: string
  ec2_instance_id: string | null
}

/** Full detail for one tenant (object page). */
export async function getTenant(id: string): Promise<TenantDetail | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, (SELECT string_agg(cd.domain, ', ' ORDER BY cd.created_at) FROM tenant_custom_domains cd WHERE cd.tenant_id = t.id AND cd.status = 'verified') AS custom_domain, t.display_name, t.status, t.daily_payout, t.own_delhivery, t.own_razorpay, t.upi_mode, t.service_types, t.store_request, t.created_at, t.instance_state,
            t.billing_interval, t.razorpay_subscription_id, t.razorpay_checkout_url, t.subscription_status,
            t.razorpay_linked_account_id,
            p.slug AS plan, p.monthly_price_inr,
            i.rds_endpoint, i.rds_db, i.rds_port, i.rds_user, i.shared_db_host, i.iam_auth, i.s3_bucket, i.ec2_target, i.ec2_instance_id, i.region, i.cloudfront_id
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.id = $1`,
    [id]
  )
  return (res.rows[0] as TenantDetail) || null
}

export interface TenantTransaction {
  id: string
  order_ref: string | null
  gross_amount: string
  tenant_share: string
  platform_commission: string
  gateway_fee: string
  is_cod: boolean
  gateway: string
  gateway_txn_id: string | null
  status: string
  occurred_at: string
  /** When a Route sale reached the store's bank, and the bank's reference. */
  payout_at?: string | null
  payout_utr?: string | null
}
export interface LedgerEntry {
  id: string
  entry_type: string
  amount: string
  note: string | null
  occurred_at: string
}

export interface BillingPage {
  limit?: number // default 50; 0 skips the rows (counts and totals still come back)
  offset?: number
}

export interface TenantBilling {
  /** Newest first, one page. */
  transactions: TenantTransaction[]
  ledger: LedgerEntry[]
  /** Rows in all, for paging. */
  transactionCount: number
  ledgerCount: number
  /** Sum of the whole ledger. */
  balance: number
  /** Over every transaction, not just the page; codGross is the cash-on-delivery part of gross. */
  totals: { gross: number; tenantShare: number; commission: number; fees: number; codGross: number }
}

const pageOf = (p?: BillingPage) => ({ limit: Math.max(0, Math.floor(p?.limit ?? 50)), offset: Math.max(0, Math.floor(p?.offset ?? 0)) })

/** Per-tenant transactions + settlement ledger, a page of each, with totals and balance over all of them. */
export async function getTenantBilling(tenantId: string, opts: { transactions?: BillingPage; ledger?: BillingPage } = {}): Promise<TenantBilling> {
  const pool = controlPlanePool()
  const tp = pageOf(opts.transactions)
  const lp = pageOf(opts.ledger)
  const none = Promise.resolve({ rows: [] as any[] })
  const [txn, led, agg] = await Promise.all([
    tp.limit
      ? pool.query(
          `SELECT t.*, s.settled_at AS payout_at, s.utr AS payout_utr
             FROM tenant_transactions t LEFT JOIN linked_account_settlements s ON s.id = t.recipient_settlement_id
            WHERE t.tenant_id=$1 ORDER BY t.occurred_at DESC LIMIT $2 OFFSET $3`,
          [tenantId, tp.limit, tp.offset]
        )
      : none,
    lp.limit
      ? pool.query(
          `SELECT id, entry_type, amount, note, occurred_at FROM settlement_ledger WHERE tenant_id=$1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3`,
          [tenantId, lp.limit, lp.offset]
        )
      : none,
    pool.query(
      `SELECT x.n AS txn_count, x.gross, x.share, x.comm, x.fees, x.cod, l.n AS ledger_count, l.balance
         FROM (SELECT count(*)::int AS n, COALESCE(SUM(gross_amount),0) AS gross, COALESCE(SUM(tenant_share),0) AS share,
                      COALESCE(SUM(platform_commission),0) AS comm, COALESCE(SUM(gateway_fee),0) AS fees,
                      COALESCE(SUM(gross_amount) FILTER (WHERE is_cod),0) AS cod
                 FROM tenant_transactions WHERE tenant_id=$1) x,
              (SELECT count(*)::int AS n, COALESCE(SUM(amount),0) AS balance FROM settlement_ledger WHERE tenant_id=$1) l`,
      [tenantId]
    ),
  ])
  const a = agg.rows[0] ?? {}
  return {
    transactions: txn.rows as TenantTransaction[],
    ledger: led.rows as LedgerEntry[],
    transactionCount: Number(a.txn_count ?? 0),
    ledgerCount: Number(a.ledger_count ?? 0),
    balance: Number(a.balance ?? 0),
    totals: { gross: Number(a.gross ?? 0), tenantShare: Number(a.share ?? 0), commission: Number(a.comm ?? 0), fees: Number(a.fees ?? 0), codGross: Number(a.cod ?? 0) },
  }
}

export interface LinkedPayout {
  id: string
  amount: string
  fees: string
  tax: string
  utr: string | null
  status: string | null
  settled_at: string | null
}

/** A Route store's recent payouts from its linked account to its bank. */
export async function listLinkedPayouts(tenantId: string, limit = 20): Promise<LinkedPayout[]> {
  const r = await controlPlanePool().query(
    `SELECT id, amount, fees, tax, utr, status, settled_at FROM linked_account_settlements
      WHERE tenant_id = $1 ORDER BY settled_at DESC NULLS LAST LIMIT $2`,
    [tenantId, limit]
  )
  return r.rows as LinkedPayout[]
}

/** Platform-wide MRR + commission summary for the billing list hero. */
export async function billingSummary(): Promise<{
  mrr: number
  commission30d: number
  gmv30d: number
  payingTenants: number
}> {
  const pool = controlPlanePool()
  const res = await pool.query(`
    SELECT
      (SELECT COALESCE(SUM(COALESCE(tc.price_inr_month, p.monthly_price_inr, 0) * CASE WHEN t.billing_interval = 'yearly' THEN 10.0 / 12 ELSE 1 END),0)
         FROM tenants t LEFT JOIN plans p ON p.id=t.plan_id
         LEFT JOIN tenant_compute tc ON tc.tenant_id = t.id
         WHERE t.status='active')::numeric AS mrr,
      (SELECT COUNT(*) FROM tenants WHERE status='active' AND 'store' = ANY(service_types))::int AS paying,
      (SELECT COALESCE(SUM(platform_commission),0) FROM tenant_transactions WHERE occurred_at > now() - interval '30 days')::numeric AS comm,
      (SELECT COALESCE(SUM(gross_amount),0) FROM tenant_transactions WHERE occurred_at > now() - interval '30 days')::numeric AS gmv
  `)
  const r = res.rows[0]
  return { mrr: Number(r.mrr), commission30d: Number(r.comm), gmv30d: Number(r.gmv), payingTenants: r.paying }
}

// ── Provisioning data-layer (control-plane) ──────────────────────────────────

export type ServiceType = 'store' | 'messaging' | 'documents'
export const SERVICE_TYPES: ServiceType[] = ['store', 'messaging', 'documents']
export const hasService = (t: { service_types?: string[] | null }, s: ServiceType) => (t.service_types ?? ['store']).includes(s)

/** Add service types to an existing tenant (idempotent). */
export async function addTenantServices(tenantId: string, types: ServiceType[]): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenants SET service_types = (SELECT array_agg(DISTINCT x) FROM unnest(service_types || $2::text[]) x), updated_at = now() WHERE id = $1`,
    [tenantId, types]
  )
}

export type StoreRequest = 'pending_approval' | 'awaiting_payment' | 'provisioning'

export async function setStoreRequest(tenantId: string, value: StoreRequest | null): Promise<void> {
  await controlPlanePool().query(`UPDATE tenants SET store_request = $2, updated_at = now() WHERE id = $1`, [tenantId, value])
}

/** Services tenant applies for a store: plan + store options, then KYC review. Status and service_types stay as they are until the first payment. */
export async function applyStoreUpgrade(
  tenantId: string,
  input: { planSlug: string; billingInterval: string; displayName?: string; dailyPayout?: boolean; ownDelhivery?: boolean; ownRazorpay?: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pool = controlPlanePool()
  const plan = await pool.query(`SELECT id FROM plans WHERE slug = $1 AND is_active = true AND product = 'store'`, [input.planSlug])
  if (!plan.rows[0]) return { ok: false, error: `Unknown or inactive plan "${input.planSlug}".` }
  const r = await pool.query(
    `UPDATE tenants SET plan_id = $2, billing_interval = $3, daily_payout = $4, own_delhivery = $5, own_razorpay = $6,
            display_name = COALESCE(NULLIF(trim($7), ''), display_name), store_request = 'pending_approval', updated_at = now()
     WHERE id = $1 AND NOT ('store' = ANY(service_types)) AND store_request IS NULL`,
    [tenantId, plan.rows[0].id, input.billingInterval, !!input.dailyPayout, !!input.ownDelhivery, !!input.ownRazorpay, input.displayName ?? '']
  )
  clearTenantCache()
  if (!r.rowCount) return { ok: false, error: 'This workspace already has a store or a store application.' }
  return { ok: true }
}
