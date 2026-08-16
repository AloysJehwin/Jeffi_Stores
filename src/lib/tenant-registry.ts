import { Pool } from 'pg'
import path from 'path'
import fs from 'fs'
import { Signer } from '@aws-sdk/rds-signer'
import type { TenantContext } from './tenant-context'

/**
 * Control-plane registry client + host->tenant resolver.
 *
 * The control plane is a SEPARATE database (jeffi_control_plane) that holds the
 * tenant registry (tenants, plans, plan_features, tenant_infra). This module owns
 * its own pool to that DB — it is NOT the per-tenant app pool in db.ts.
 *
 * resolveTenantFromHost() maps a request Host header to a TenantContext, cached
 * in-process (short TTL) to keep the hot path off the DB. Returns null for the
 * platform's own hosts (jeffistores.in + its app subdomains) and unknown hosts —
 * a null result means "no tenant", and downstream code falls back to the default
 * (platform) resources, preserving single-tenant behavior.
 */

// Hosts/labels that are the PLATFORM's own, never a tenant slug.
export const RESERVED_LABELS = new Set([
  'admin', 'business', 'forms', 'www', 'ecom', 'invoice', 'quotation',
  'purchaseorder', 'api', 'app', 'mail', 'static', 'assets', 'cdn',
])

const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

let cpPool: Pool | null = null
function controlPlanePool(): Pool {
  if (cpPool) return cpPool
  let url = process.env.CONTROL_PLANE_DATABASE_URL || ''
  const iam = process.env.CONTROL_PLANE_IAM_AUTH === 'true'
  // Local-dev fallback: predev regenerates .env.local from Secrets Manager and may not
  // carry CONTROL_PLANE_DATABASE_URL. In development, derive the local control-plane DB
  // from the app's own DATABASE_URL (same host/user), swapping the db name to
  // jeffi_control_plane — so `npm run dev` just works without manual env upkeep.
  if (!url && !iam && process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL) {
    try {
      const u = new URL(process.env.DATABASE_URL)
      u.pathname = '/jeffi_control_plane'
      url = u.toString()
    } catch { /* leave url empty; the guard below throws a clear error */ }
  }
  if (!url && !iam) {
    throw new Error('Control-plane DB not configured: set CONTROL_PLANE_DATABASE_URL (or CONTROL_PLANE_IAM_AUTH=true).')
  }
  const config: any = { max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000, keepAlive: true }
  if (iam) {
    const host = process.env.CONTROL_PLANE_RDS_HOST!
    const port = parseInt(process.env.CONTROL_PLANE_RDS_PORT || '5432', 10)
    const user = process.env.CONTROL_PLANE_RDS_USER || 'app_user'
    const region = process.env.AWS_REGION || 'us-east-1'
    const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
    config.host = host
    config.port = port
    config.user = user
    config.database = process.env.CONTROL_PLANE_RDS_DB || 'jeffi_control_plane'
    config.ssl = fs.existsSync(certPath)
      ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
      : { rejectUnauthorized: false }
    const signer = new Signer({ hostname: host, port, region, username: user })
    config.password = () => signer.getAuthToken()
  } else {
    config.connectionString = url
    if (url.includes('rds.amazonaws.com')) {
      const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
      if (fs.existsSync(certPath)) config.ssl = { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
    }
  }
  cpPool = new Pool(config)
  cpPool.on('error', () => { /* idle-client error — pool self-heals */ })
  return cpPool
}

// In-process cache: host -> { ctx, expires }. Short TTL so tenant/plan changes
// propagate quickly; a null ctx (platform host / unknown) is also cached to avoid
// hammering the DB for the flagship store's own traffic.
type CacheEntry = { ctx: TenantContext | null; expires: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000

/** Parse a Host header into a tenant slug, or null if it's a platform/app host. */
export function slugFromHost(hostname: string): { slug: string | null; isCustomDomain: boolean } {
  const host = hostname.toLowerCase().split(':')[0].trim()
  // Custom domain: not under the platform root at all.
  if (!host.endsWith('.' + ROOT_DOMAIN) && host !== ROOT_DOMAIN) {
    // Could be a tenant's own domain — resolve by custom_domain lookup.
    if (host && host !== 'localhost' && !host.endsWith('.local')) {
      return { slug: null, isCustomDomain: true }
    }
    return { slug: null, isCustomDomain: false }
  }
  if (host === ROOT_DOMAIN) return { slug: null, isCustomDomain: false } // apex = platform
  const label = host.slice(0, host.length - ROOT_DOMAIN.length - 1) // strip ".jeffistores.in"
  // App subdomains like admin-{tenant} / invoice-{tenant}: strip the app prefix.
  const appPrefixed = label.match(/^(admin|invoice|quotation|purchaseorder|www)-(.+)$/)
  const bare = appPrefixed ? appPrefixed[2] : label
  // Reserved single-label app hosts (admin. / business. / forms. etc.) = platform, not tenant.
  if (RESERVED_LABELS.has(bare)) return { slug: null, isCustomDomain: false }
  // A multi-level label (e.g. "a.b") isn't a valid single tenant slug.
  if (bare.includes('.')) return { slug: null, isCustomDomain: false }
  return { slug: bare, isCustomDomain: false }
}

async function lookupTenant(where: 'slug' | 'custom_domain', value: string): Promise<TenantContext | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, t.status, p.slug AS plan,
            i.rds_endpoint, i.rds_db, i.rds_port, i.db_secret_ref, i.iam_auth, i.s3_bucket, i.region
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.${where} = $1
     LIMIT 1`,
    [value]
  )
  const r = res.rows[0]
  if (!r) return null
  if (r.status !== 'active') return null // suspended/provisioning/terminated → treated as no-serve
  return {
    tenantId: r.id,
    slug: r.slug,
    plan: r.plan ?? null,
    infra: r.rds_endpoint
      ? {
          rdsEndpoint: r.rds_endpoint,
          rdsDb: r.rds_db || 'jeffi_stores',
          rdsPort: r.rds_port || 5432,
          dbSecretRef: r.db_secret_ref ?? null,
          iamAuth: r.iam_auth !== false,
          s3Bucket: r.s3_bucket ?? null,
          region: r.region || 'us-east-1',
        }
      : null,
  }
}

/** Resolve a Host header to a TenantContext, or null for platform/unknown hosts. */
export async function resolveTenantFromHost(hostname: string): Promise<TenantContext | null> {
  const key = hostname.toLowerCase().split(':')[0]
  const cached = cache.get(key)
  const now = Date.now()
  if (cached && cached.expires > now) return cached.ctx

  let ctx: TenantContext | null = null
  try {
    const { slug, isCustomDomain } = slugFromHost(key)
    if (slug) {
      ctx = await lookupTenant('slug', slug)
    } else if (isCustomDomain) {
      ctx = await lookupTenant('custom_domain', key)
    }
  } catch {
    // Fail open: on any control-plane error, treat as no tenant (platform default).
    ctx = null
  }
  cache.set(key, { ctx, expires: now + CACHE_TTL_MS })
  return ctx
}

/** Test/ops hook: drop the resolver cache (e.g. after a tenant status change). */
export function clearTenantCache(): void {
  cache.clear()
}

export interface TenantRow {
  id: string
  slug: string
  custom_domain: string | null
  display_name: string
  status: string
  plan: string | null
  monthly_price_inr: string | null
  daily_payout: boolean
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
  if (filters?.status) { args.push(filters.status); where.push(`t.status = $${args.length}`) }
  if (filters?.plan) { args.push(filters.plan); where.push(`p.slug = $${args.length}`) }
  if (filters?.q) { args.push(`%${filters.q.toLowerCase()}%`); where.push(`(lower(t.display_name) LIKE $${args.length} OR lower(t.slug) LIKE $${args.length})`) }
  const res = await pool.query(
    `SELECT t.id, t.slug, t.custom_domain, t.display_name, t.status, t.daily_payout, t.created_at,
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

// Valid tenant slug: 3-63 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/

export interface CreateTenantInput {
  slug: string
  displayName: string
  planSlug: string
  dailyPayout?: boolean
  warehouse?: {
    originPincode?: string
    pickupLocation?: string
    sellerName?: string
    sellerAddress?: string
    sellerPhone?: string
  }
}

export type CreateTenantResult =
  | { ok: true; tenantId: string; slug: string }
  | { ok: false; error: string }

/**
 * Create a tenant in the control-plane registry (status='provisioning'). Validates
 * the slug (format + reserved-word + uniqueness) and the plan. Does NOT provision
 * any AWS infra — that's the separate provisioning engine; a tenant_infra row is
 * created empty and filled in when infra is stood up.
 */
export async function createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
  const slug = (input.slug || '').toLowerCase().trim()
  if (!SLUG_RE.test(slug)) {
    return { ok: false, error: 'Slug must be 3-63 chars, lowercase letters/numbers/hyphens, no leading/trailing hyphen.' }
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
      `INSERT INTO tenants (slug, display_name, plan_id, status, daily_payout)
       VALUES ($1, $2, $3, 'provisioning', $4) RETURNING id`,
      [slug, input.displayName.trim(), plan.rows[0].id, !!input.dailyPayout]
    )
    const tenantId = t.rows[0].id
    // Empty infra row (rds_endpoint null → resolver returns tenant with null infra →
    // default pool) until the provisioning engine fills it in.
    await client.query(
      `INSERT INTO tenant_infra (tenant_id, s3_bucket) VALUES ($1, $2)`,
      [tenantId, `jeffi-tenant-${slug}`]
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
export async function listPlans(): Promise<Array<{ slug: string; name: string; tier: number; monthly_price_inr: string }>> {
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
}

/** Full detail for one tenant (object page). */
export async function getTenant(id: string): Promise<TenantDetail | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, t.custom_domain, t.display_name, t.status, t.daily_payout, t.created_at, t.instance_state,
            p.slug AS plan, p.monthly_price_inr,
            i.rds_endpoint, i.rds_db, i.rds_port, i.iam_auth, i.s3_bucket, i.ec2_target, i.region, i.cloudfront_id
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.id = $1`,
    [id]
  )
  return (res.rows[0] as TenantDetail) || null
}

export interface TenantTransaction {
  id: string; order_ref: string | null; gross_amount: string; tenant_share: string
  platform_commission: string; gateway_fee: string; is_cod: boolean; gateway: string
  gateway_txn_id: string | null; status: string; occurred_at: string
}
export interface LedgerEntry {
  id: string; entry_type: string; amount: string; note: string | null; occurred_at: string
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
    pool.query(`SELECT id, entry_type, amount, note, occurred_at FROM settlement_ledger WHERE tenant_id=$1 ORDER BY occurred_at DESC`, [tenantId]),
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
export async function billingSummary(): Promise<{ mrr: number; commission30d: number; gmv30d: number; payingTenants: number }> {
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

export interface ProvisioningJob {
  id: string; tenant_id: string; step: string; status: string
  attempts: number; last_error: string | null; created_resources: Record<string, any>
}

/** Create (or return existing pending) provisioning job for a tenant. */
export async function enqueueProvisioning(tenantId: string): Promise<ProvisioningJob> {
  const pool = controlPlanePool()
  const existing = await pool.query(
    `SELECT * FROM provisioning_jobs WHERE tenant_id=$1 AND status IN ('pending','running') LIMIT 1`, [tenantId])
  if (existing.rows[0]) return existing.rows[0] as ProvisioningJob
  const res = await pool.query(
    `INSERT INTO provisioning_jobs (tenant_id) VALUES ($1) RETURNING *`, [tenantId])
  return res.rows[0] as ProvisioningJob
}

/** Fetch active jobs the worker should advance. */
export async function activeProvisioningJobs(): Promise<ProvisioningJob[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT * FROM provisioning_jobs WHERE status IN ('pending','running') ORDER BY created_at`)
  return res.rows as ProvisioningJob[]
}

export async function getProvisioningJob(tenantId: string): Promise<ProvisioningJob | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT * FROM provisioning_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [tenantId])
  return (res.rows[0] as ProvisioningJob) || null
}

/** Advance a job's step/status/resources. */
export async function updateProvisioningJob(
  id: string,
  patch: { step?: string; status?: string; last_error?: string | null; created_resources?: Record<string, any>; bumpAttempts?: boolean }
): Promise<void> {
  const pool = controlPlanePool()
  const sets: string[] = ['updated_at = now()']
  const args: any[] = []
  if (patch.step !== undefined) { args.push(patch.step); sets.push(`step=$${args.length}`) }
  if (patch.status !== undefined) { args.push(patch.status); sets.push(`status=$${args.length}`) }
  if (patch.last_error !== undefined) { args.push(patch.last_error); sets.push(`last_error=$${args.length}`) }
  if (patch.created_resources !== undefined) { args.push(JSON.stringify(patch.created_resources)); sets.push(`created_resources=$${args.length}::jsonb`) }
  if (patch.bumpAttempts) sets.push('attempts = attempts + 1')
  args.push(id)
  await pool.query(`UPDATE provisioning_jobs SET ${sets.join(', ')} WHERE id=$${args.length}`, args)
}

/** Set a tenant's status (e.g. provisioning->active) or instance_state (running/stopped). */
export async function setTenantStatus(tenantId: string, status: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE tenants SET status=$1, updated_at=now() WHERE id=$2`, [status, tenantId])
}
export async function setTenantInstanceState(tenantId: string, state: 'running' | 'stopped'): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE tenants SET instance_state=$1, updated_at=now() WHERE id=$2`, [state, tenantId])
}
/** Write resolved infra pointers after provisioning. */
export async function writeTenantInfra(tenantId: string, infra: { rdsEndpoint: string; s3Bucket: string }): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_infra SET rds_endpoint=$1, s3_bucket=$2, iam_auth=true, updated_at=now() WHERE tenant_id=$3`,
    [infra.rdsEndpoint, infra.s3Bucket, tenantId])
}
