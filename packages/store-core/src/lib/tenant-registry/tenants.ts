import { controlPlanePool, RESERVED_LABELS } from './shared'
import { clearTenantCache } from './host-resolution'

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

/** List tenants (control-plane admin UI). Read-only, optional filters. */
export async function listTenants(filters?: { status?: string; plan?: string; q?: string; product?: 'store' | 'api' }): Promise<TenantRow[]> {
  const pool = controlPlanePool()
  const where: string[] = []
  const args: any[] = []
  if (filters?.status === 'review') {
    // Anything waiting on Jeffi: store KYC or a requested Messaging/Documents service.
    where.push(`(EXISTS (SELECT 1 FROM tenant_kyc k WHERE k.tenant_id = t.id AND k.status = 'pending')
              OR EXISTS (SELECT 1 FROM tenant_service_approvals a WHERE a.tenant_id = t.id AND a.status = 'pending'))`)
  } else if (filters?.status) {
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
    `SELECT t.id, t.slug, t.custom_domain, t.display_name, t.status, t.daily_payout, t.own_delhivery, t.own_razorpay, t.service_types, t.store_request, t.created_at,
            p.slug AS plan, p.monthly_price_inr,
            i.rds_endpoint, i.s3_bucket, i.ec2_target, i.region
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.created_at DESC`,
    args
  )
  return res.rows as TenantRow[]
}

/** Summary counts for the control-plane dashboard. */
export async function tenantSummary(): Promise<{ total: number; active: number; mrr: number }> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE t.status='active')::int AS active,
            COALESCE(SUM(p.monthly_price_inr) FILTER (WHERE t.status='active'), 0)::numeric AS mrr
     FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id`
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
  if (RESERVED_LABELS.has(slug)) {
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
export async function listPlans(): Promise<
  Array<{ slug: string; name: string; tier: number; monthly_price_inr: string }>
> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT slug, name, tier, monthly_price_inr FROM plans WHERE is_active = true ORDER BY tier`
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
    `SELECT t.id, t.slug, t.custom_domain, t.display_name, t.status, t.daily_payout, t.own_delhivery, t.own_razorpay, t.service_types, t.store_request, t.created_at, t.instance_state,
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

/** Per-tenant transactions + settlement ledger + computed balance (billing detail page). */
export async function getTenantBilling(tenantId: string): Promise<{
  transactions: TenantTransaction[]
  ledger: LedgerEntry[]
  balance: number
  totals: { gross: number; tenantShare: number; commission: number; fees: number }
}> {
  const pool = controlPlanePool()
  const [txn, led] = await Promise.all([
    pool.query(
      `SELECT t.*, s.settled_at AS payout_at, s.utr AS payout_utr
         FROM tenant_transactions t LEFT JOIN linked_account_settlements s ON s.id = t.recipient_settlement_id
        WHERE t.tenant_id=$1 ORDER BY t.occurred_at DESC`,
      [tenantId]
    ),
    pool.query(
      `SELECT id, entry_type, amount, note, occurred_at FROM settlement_ledger WHERE tenant_id=$1 ORDER BY occurred_at DESC`,
      [tenantId]
    ),
  ])
  const transactions = txn.rows as TenantTransaction[]
  const ledger = led.rows as LedgerEntry[]
  const balance = ledger.reduce((s, e) => s + Number(e.amount), 0)
  const totals = transactions.reduce(
    (a, t) => ({
      gross: a.gross + Number(t.gross_amount),
      tenantShare: a.tenantShare + Number(t.tenant_share),
      commission: a.commission + Number(t.platform_commission),
      fees: a.fees + Number(t.gateway_fee),
    }),
    { gross: 0, tenantShare: 0, commission: 0, fees: 0 }
  )
  return { transactions, ledger, balance, totals }
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
      (SELECT COALESCE(SUM(p.monthly_price_inr),0) FROM tenants t JOIN plans p ON p.id=t.plan_id WHERE t.status='active')::numeric AS mrr,
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
