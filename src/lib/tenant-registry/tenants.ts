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
  billing_interval: string
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
export async function listTenants(filters?: { status?: string; plan?: string; q?: string }): Promise<TenantRow[]> {
  const pool = controlPlanePool()
  const where: string[] = []
  const args: any[] = []
  if (filters?.status) {
    args.push(filters.status)
    where.push(`t.status = $${args.length}`)
  }
  if (filters?.plan) {
    args.push(filters.plan)
    where.push(`p.slug = $${args.length}`)
  }
  if (filters?.q) {
    args.push(`%${filters.q.toLowerCase()}%`)
    where.push(`(lower(t.display_name) LIKE $${args.length} OR lower(t.slug) LIKE $${args.length})`)
  }
  const res = await pool.query(
    `SELECT t.id, t.slug, t.custom_domain, t.display_name, t.status, t.daily_payout, t.own_delhivery, t.own_razorpay, t.created_at,
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
      `INSERT INTO tenants (slug, display_name, plan_id, status, billing_interval, daily_payout, own_delhivery, own_razorpay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        slug,
        input.displayName.trim(),
        plan.rows[0].id,
        input.status ?? 'provisioning',
        input.billingInterval ?? 'monthly',
        !!input.dailyPayout,
        !!input.ownDelhivery,
        !!input.ownRazorpay,
      ]
    )
    const tenantId = t.rows[0].id
    // Empty infra row (rds_endpoint null → resolver returns tenant with null infra →
    // default pool) until the provisioning engine fills it in.
    await client.query(`INSERT INTO tenant_infra (tenant_id, s3_bucket) VALUES ($1, $2)`, [
      tenantId,
      `jeffi-tenant-${slug}`,
    ])
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
  iam_auth: boolean | null
  cloudfront_id: string | null
  instance_state: string
  ec2_instance_id: string | null
}

/** Full detail for one tenant (object page). */
export async function getTenant(id: string): Promise<TenantDetail | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, t.custom_domain, t.display_name, t.status, t.daily_payout, t.own_delhivery, t.own_razorpay, t.created_at, t.instance_state,
            t.billing_interval, t.razorpay_subscription_id, t.razorpay_checkout_url, t.subscription_status,
            t.razorpay_linked_account_id,
            p.slug AS plan, p.monthly_price_inr,
            i.rds_endpoint, i.rds_db, i.rds_port, i.iam_auth, i.s3_bucket, i.ec2_target, i.ec2_instance_id, i.region, i.cloudfront_id
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
    pool.query(`SELECT * FROM tenant_transactions WHERE tenant_id=$1 ORDER BY occurred_at DESC`, [tenantId]),
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
      (SELECT COUNT(*) FROM tenants WHERE status='active')::int AS paying,
      (SELECT COALESCE(SUM(platform_commission),0) FROM tenant_transactions WHERE occurred_at > now() - interval '30 days')::numeric AS comm,
      (SELECT COALESCE(SUM(gross_amount),0) FROM tenant_transactions WHERE occurred_at > now() - interval '30 days')::numeric AS gmv
  `)
  const r = res.rows[0]
  return { mrr: Number(r.mrr), commission30d: Number(r.comm), gmv30d: Number(r.gmv), payingTenants: r.paying }
}

// ── Provisioning data-layer (control-plane) ──────────────────────────────────

