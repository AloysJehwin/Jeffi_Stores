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

// Cache the control-plane pool on globalThis so Next.js dev / Turbopack hot-reloads
// (which re-import this module) reuse the SAME pg.Pool instead of spawning a fresh
// one each reload — otherwise the orphaned pools accumulate open connections and
// local Postgres hits "sorry, too many clients already".
const cpGlobal = globalThis as unknown as { __cpPool?: Pool }
export function controlPlanePool(): Pool {
  if (cpGlobal.__cpPool) return cpGlobal.__cpPool
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
  const p = new Pool(config)
  p.on('error', () => { /* idle-client error — pool self-heals */ })
  cpGlobal.__cpPool = p
  return p
}

// In-process cache: host -> { ctx, expires }. Short TTL so tenant/plan changes
// propagate quickly; a null ctx (platform host / unknown) is also cached to avoid
// hammering the DB for the flagship store's own traffic.
type CacheEntry = { ctx: TenantContext | null; expires: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60_000

/** Parse a Host header into a tenant slug, or null if it's a platform/app host. */
/**
 * Development hosts, which are never a tenant's custom domain.
 *
 * `.localhost` is reserved by RFC 6761 and can never resolve publicly, so exempting it cannot
 * weaken the production guard. Without this, dev subdomains — ecom.localhost, admin.localhost,
 * admin-{slug}.localhost — looked like custom domains, resolved to no tenant, and the
 * fail-closed branch in middleware returned 404 before the host could be dispatched.
 */
function isLocalHost(host: string): boolean {
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '127.0.0.1'
    || host === '::1'
    || host === '[::1]'
}

export function slugFromHost(hostname: string): { slug: string | null; isCustomDomain: boolean } {
  const host = hostname.toLowerCase().split(':')[0].trim()
  // Custom domain: not under the platform root at all.
  if (!host.endsWith('.' + ROOT_DOMAIN) && host !== ROOT_DOMAIN) {
    // Could be a tenant's own domain — resolve by custom_domain lookup.
    if (host && !isLocalHost(host)) {
      return { slug: null, isCustomDomain: true }
    }
    return { slug: null, isCustomDomain: false }
  }
  if (host === ROOT_DOMAIN) return { slug: null, isCustomDomain: false } // apex = platform
  const label = host.slice(0, host.length - ROOT_DOMAIN.length - 1) // strip ".jeffistores.in"
  // App subdomains like admin-{tenant} / invoice-{tenant}, plus {tenant}.business.
  const businessScoped = label.match(/^(.+)\.business$/)
  const appPrefixed = label.match(/^(admin|invoice|quotation|purchaseorder|forms|www)-(.+)$/)
  const bare = businessScoped ? businessScoped[1] : appPrefixed ? appPrefixed[2] : label
  // Reserved single-label app hosts (admin. / business. / forms. etc.) = platform, not tenant.
  if (RESERVED_LABELS.has(bare)) return { slug: null, isCustomDomain: false }
  // A multi-level label (e.g. "a.b") isn't a valid single tenant slug.
  if (bare.includes('.')) return { slug: null, isCustomDomain: false }
  return { slug: bare, isCustomDomain: false }
}

export type HostApp = 'admin' | 'invoice' | 'quotation' | 'purchaseorder' | 'forms' | 'business'

const APP_PREFIXES: HostApp[] = ['admin', 'invoice', 'quotation', 'purchaseorder', 'forms', 'business']

/** Which app surface a host addresses: `admin.` (platform) and `admin-{slug}.` (tenant) both → 'admin'. */
export function appFromHost(hostname: string): HostApp | null {
  const host = hostname.toLowerCase().split(':')[0].trim()
  const underRoot = host.endsWith('.' + ROOT_DOMAIN)
  const label = underRoot ? host.slice(0, host.length - ROOT_DOMAIN.length - 1) : host
  const parts = label.split('.')
  if (underRoot && parts.length === 2 && parts[1] === 'business') return 'business'
  const first = parts[0]
  for (const p of APP_PREFIXES) {
    if (first === p) return p
    if (underRoot && first.startsWith(p + '-')) return p
  }
  return null
}

export { formsHostForSlug, formsHostForHost } from './forms-host'

async function lookupTenant(where: 'slug' | 'custom_domain', value: string): Promise<TenantContext | null> {
  const pool = controlPlanePool()
  // For custom_domain, resolve via the tenant_custom_domains table (verified only),
  // falling back to the legacy tenants.custom_domain column for backward compat.
  const whereClause = where === 'custom_domain'
    ? `t.id = (
         SELECT tenant_id FROM tenant_custom_domains WHERE domain = $1 AND status = 'verified'
         UNION ALL
         SELECT id FROM tenants WHERE custom_domain = $1
         LIMIT 1
       )`
    : `t.${where} = $1`
  const res = await pool.query(
    `SELECT t.id, t.slug, t.display_name, t.status, p.slug AS plan,
            i.rds_endpoint, i.rds_db, i.rds_port, i.db_secret_ref, i.iam_auth, i.s3_bucket, i.region
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE ${whereClause}
     LIMIT 1`,
    [value]
  )
  const r = res.rows[0]
  if (!r) return null
  if (r.status !== 'active') return null // suspended/provisioning/terminated → treated as no-serve
  return {
    tenantId: r.id,
    slug: r.slug,
    displayName: r.display_name ?? null,
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
  const { slug, isCustomDomain } = slugFromHost(key)
  try {
    if (slug) {
      ctx = await lookupTenant('slug', slug)
    } else if (isCustomDomain) {
      ctx = await lookupTenant('custom_domain', key)
    }
  } catch (err) {
    // Fail closed on tenant hosts: returning null here would serve the platform DB.
    if (slug || isCustomDomain) throw err
    ctx = null
  }
  cache.set(key, { ctx, expires: now + CACHE_TTL_MS })
  return ctx
}

/** Test/ops hook: drop the resolver cache (e.g. after a tenant status change). */
export function clearTenantCache(): void {
  cache.clear()
}

/**
 * Resolve a full TenantContext (incl. infra) from a tenant slug. Used by the DB layer
 * to establish per-request tenant context from the x-tenant-slug header middleware sets
 * (Edge middleware's AsyncLocalStorage does NOT propagate to Node handlers, so the pool
 * selector must re-resolve inside the request). Cached like resolveTenantFromHost.
 */
export async function lookupTenantContextBySlug(slug: string): Promise<TenantContext | null> {
  const key = `slug:${slug}`
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expires > now) return cached.ctx
  let ctx: TenantContext | null = null
  try {
    ctx = await lookupTenant('slug', slug)
  } catch {
    ctx = null
  }
  cache.set(key, { ctx, expires: now + CACHE_TTL_MS })
  return ctx
}

// Resolve a full TenantContext by tenant id, for background workers (import worker) that
// enumerate control-plane jobs then re-enter each tenant's context. Not cached — the worker
// runs each job once and must see current infra. Active tenants only, like lookupTenant.
export async function lookupTenantContextById(tenantId: string): Promise<TenantContext | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, t.display_name, t.status, p.slug AS plan,
            i.rds_endpoint, i.rds_db, i.rds_port, i.db_secret_ref, i.iam_auth, i.s3_bucket, i.region
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.id = $1 LIMIT 1`,
    [tenantId],
  )
  const r = res.rows[0]
  if (!r || r.status !== 'active' || !r.rds_endpoint) return null
  return {
    tenantId: r.id,
    slug: r.slug,
    displayName: r.display_name ?? null,
    plan: r.plan ?? null,
    infra: {
      rdsEndpoint: r.rds_endpoint,
      rdsDb: r.rds_db || 'jeffi_stores',
      rdsPort: r.rds_port || 5432,
      dbSecretRef: r.db_secret_ref ?? null,
      iamAuth: r.iam_auth !== false,
      s3Bucket: r.s3_bucket ?? null,
      region: r.region || 'us-east-1',
    },
  }
}

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
  if (filters?.status) { args.push(filters.status); where.push(`t.status = $${args.length}`) }
  if (filters?.plan) { args.push(filters.plan); where.push(`p.slug = $${args.length}`) }
  if (filters?.q) { args.push(`%${filters.q.toLowerCase()}%`); where.push(`(lower(t.display_name) LIKE $${args.length} OR lower(t.slug) LIKE $${args.length})`) }
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
      `INSERT INTO tenants (slug, display_name, plan_id, status, billing_interval, daily_payout, own_delhivery, own_razorpay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [slug, input.displayName.trim(), plan.rows[0].id,
       input.status ?? 'provisioning', input.billingInterval ?? 'monthly', !!input.dailyPayout,
       !!input.ownDelhivery, !!input.ownRazorpay]
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
  next_attempt_at?: string | null
  created_at: string; updated_at: string
}

/** Create (or return existing pending) provisioning job for a tenant. */
export async function enqueueProvisioning(tenantId: string, opts?: { restoreFromKey?: string }): Promise<ProvisioningJob> {
  const pool = controlPlanePool()
  const existing = await pool.query(
    `SELECT * FROM provisioning_jobs WHERE tenant_id=$1 AND status IN ('pending','running') LIMIT 1`, [tenantId])
  if (existing.rows[0]) return existing.rows[0] as ProvisioningJob
  const created = opts?.restoreFromKey ? { restoreFromKey: opts.restoreFromKey } : {}
  const res = await pool.query(
    `INSERT INTO provisioning_jobs (tenant_id, created_resources) VALUES ($1, $2::jsonb) RETURNING *`,
    [tenantId, JSON.stringify(created)])
  return res.rows[0] as ProvisioningJob
}

export type ResumeOutcome =
  | { ok: true; resumedFrom: string }
  | { ok: false; reason: 'no_failed_job' | 'rolled_back' | 'already_running'; detail: string }

/**
 * Put a failed job back in the queue at the step it died on, keeping created_resources so the
 * worker skips what already succeeded.
 *
 * Refuses when rollback has run. Rollback DELETES the RDS instance, bucket and DNS it recorded,
 * so resuming at (say) ensure_compute would carry on against infrastructure that no longer
 * exists. Those runs have to start over — enqueueProvisioning already does that by opening a
 * fresh job.
 */
export async function resumeProvisioningJob(tenantId: string): Promise<ResumeOutcome> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT * FROM provisioning_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [tenantId])
  const job = res.rows[0] as ProvisioningJob | undefined

  if (!job) return { ok: false, reason: 'no_failed_job', detail: 'This tenant has no provisioning job.' }
  if (job.status === 'pending' || job.status === 'running') {
    return { ok: false, reason: 'already_running', detail: `A job is already ${job.status} at "${job.step}".` }
  }
  if (job.status !== 'failed') {
    return { ok: false, reason: 'no_failed_job', detail: `The last job is "${job.status}", not failed.` }
  }
  if ((job.created_resources as Record<string, unknown> | null)?.rolledBack === true) {
    return {
      ok: false, reason: 'rolled_back',
      detail: `This run was rolled back — its database, bucket and DNS were deleted. Resuming at "${job.step}" would build on infrastructure that no longer exists; start a fresh provision instead.`,
    }
  }

  await pool.query(
    `UPDATE provisioning_jobs
        SET status='pending', last_error=NULL, next_attempt_at=NULL, updated_at=now()
      WHERE id=$1`, [job.id])
  return { ok: true, resumedFrom: job.step }
}

/** Fetch active jobs the worker should advance (skips jobs backing off until next_attempt_at). */
export async function activeProvisioningJobs(): Promise<ProvisioningJob[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT * FROM provisioning_jobs
     WHERE status IN ('pending','running')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER BY created_at`)
  return res.rows as ProvisioningJob[]
}

export interface ProvisioningJobRow extends ProvisioningJob {
  slug: string
  display_name: string
  tenant_status: string
  plan: string | null
}

/** Latest provisioning job per tenant, for the provisioning list page. */
export async function listProvisioningJobs(filters?: { status?: string; q?: string }): Promise<ProvisioningJobRow[]> {
  const pool = controlPlanePool()
  const where: string[] = []
  const args: any[] = []
  if (filters?.status) { args.push(filters.status); where.push(`j.status = $${args.length}`) }
  if (filters?.q) { args.push(`%${filters.q.toLowerCase()}%`); where.push(`(lower(t.display_name) LIKE $${args.length} OR lower(t.slug) LIKE $${args.length})`) }
  const res = await pool.query(
    `SELECT DISTINCT ON (j.tenant_id) j.*, t.slug, t.display_name, t.status AS tenant_status, p.slug AS plan
     FROM provisioning_jobs j
     JOIN tenants t ON t.id = j.tenant_id
     LEFT JOIN plans p ON p.id = t.plan_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY j.tenant_id, j.created_at DESC`,
    args
  )
  return (res.rows as ProvisioningJobRow[]).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

export async function provisioningSummary(): Promise<{ total: number; running: number; failed: number; done: number }> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('pending','running'))::int AS running,
            count(*) FILTER (WHERE status='failed')::int AS failed,
            count(*) FILTER (WHERE status='done')::int AS done
     FROM (SELECT DISTINCT ON (tenant_id) status FROM provisioning_jobs ORDER BY tenant_id, created_at DESC) s`)
  return res.rows[0]
}

export async function getProvisioningJobById(jobId: string): Promise<ProvisioningJobRow | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT j.*, t.slug, t.display_name, t.status AS tenant_status, p.slug AS plan
     FROM provisioning_jobs j
     JOIN tenants t ON t.id = j.tenant_id
     LEFT JOIN plans p ON p.id = t.plan_id
     WHERE j.id = $1`, [jobId])
  return (res.rows[0] as ProvisioningJobRow) || null
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
  patch: { step?: string; status?: string; last_error?: string | null; created_resources?: Record<string, any>; bumpAttempts?: boolean; nextAttemptAt?: Date | null; clearNextAttempt?: boolean }
): Promise<void> {
  const pool = controlPlanePool()
  const sets: string[] = ['updated_at = now()']
  const args: any[] = []
  if (patch.step !== undefined) { args.push(patch.step); sets.push(`step=$${args.length}`) }
  if (patch.status !== undefined) { args.push(patch.status); sets.push(`status=$${args.length}`) }
  if (patch.last_error !== undefined) { args.push(patch.last_error); sets.push(`last_error=$${args.length}`) }
  if (patch.created_resources !== undefined) { args.push(JSON.stringify(patch.created_resources)); sets.push(`created_resources=$${args.length}::jsonb`) }
  if (patch.bumpAttempts) sets.push('attempts = attempts + 1')
  if (patch.nextAttemptAt !== undefined && patch.nextAttemptAt !== null) { args.push(patch.nextAttemptAt.toISOString()); sets.push(`next_attempt_at=$${args.length}`) }
  if (patch.clearNextAttempt) sets.push('next_attempt_at = NULL')
  args.push(id)
  await pool.query(`UPDATE provisioning_jobs SET ${sets.join(', ')} WHERE id=$${args.length}`, args)
}

/** Set a tenant's status (e.g. provisioning->active) or instance_state (running/stopped). */
export async function setTenantStatus(tenantId: string, status: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE tenants SET status=$1, updated_at=now() WHERE id=$2`, [status, tenantId])
}

/**
 * Reconciliation sweep: find tenants marked 'active' but whose infra is gone (rds_endpoint
 * NULL) — an inconsistent state where the resolver would route to a non-existent DB (or, if
 * infra is null, silently fall back to the platform DB). Flip them to 'suspended' so they
 * stop being served and surface for operator attention. Returns the affected tenant ids.
 * Safe + idempotent; run periodically from the provisioning cron worker.
 */
export async function reconcileOrphanedTenants(): Promise<string[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `UPDATE tenants t SET status='suspended', updated_at=now()
     WHERE t.status='active'
       AND NOT EXISTS (
         SELECT 1 FROM tenant_infra i WHERE i.tenant_id = t.id AND i.rds_endpoint IS NOT NULL
       )
     RETURNING t.id`)
  if (res.rowCount && res.rowCount > 0) clearTenantCache()
  return res.rows.map((r) => r.id as string)
}
export async function saveLinkedAccountId(tenantId: string, linkedAccountId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenants SET razorpay_linked_account_id=$1, updated_at=now() WHERE id=$2`,
    [linkedAccountId, tenantId],
  )
}

/**
 * Switch a tenant between collecting on its own Razorpay account (skip Route split, zero platform
 * charges) and the platform account (full Route split). Enabling own-account requires connected
 * tenant Razorpay credentials — enforced by the caller, not here.
 */
export async function setOwnRazorpay(tenantId: string, value: boolean): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenants SET own_razorpay=$1, updated_at=now() WHERE id=$2`,
    [value, tenantId],
  )
}

/**
 * Flip whether a tenant ships on their own Delhivery token. Enabling requires a connected Delhivery
 * token — enforced by the caller (delivery-mode route), not here.
 */
export async function setOwnDelhivery(tenantId: string, value: boolean): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenants SET own_delhivery=$1, updated_at=now() WHERE id=$2`,
    [value, tenantId],
  )
}

/**
 * Copy the Razorpay linked account (acc_xxx) onto the owner-scoped bank row so it survives a
 * hard tenant purge. tenant_bank_accounts cascades off owners (not tenants), so this value
 * outlives the tenant DELETE and lets a re-onboarding owner reuse their existing Route account
 * (Razorpay enforces one linked account per merchant email). Idempotent.
 */
export async function persistLinkedAccountToOwnerBank(ownerId: string, linkedAccountId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_bank_accounts SET linked_account_id=$2, updated_at=now()
     WHERE owner_id=$1 AND linked_account_id IS DISTINCT FROM $2`,
    [ownerId, linkedAccountId],
  )
}

export async function saveSubscriptionId(tenantId: string, subscriptionId: string, billingInterval?: string, checkoutUrl?: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenants SET razorpay_subscription_id=$1, subscription_status='created',
      billing_interval=COALESCE($3, billing_interval),
      razorpay_checkout_url=COALESCE($4, razorpay_checkout_url),
      updated_at=now() WHERE id=$2`,
    [subscriptionId, tenantId, billingInterval ?? null, checkoutUrl ?? null],
  )
}

export async function setSubscriptionStatus(tenantId: string, subscriptionStatus: string, tenantStatus?: string): Promise<void> {
  const pool = controlPlanePool()
  if (tenantStatus) {
    await pool.query(
      `UPDATE tenants SET subscription_status=$1, status=$2, updated_at=now() WHERE id=$3`,
      [subscriptionStatus, tenantStatus, tenantId],
    )
  } else {
    await pool.query(
      `UPDATE tenants SET subscription_status=$1, updated_at=now() WHERE id=$2`,
      [subscriptionStatus, tenantId],
    )
  }
}

export async function getTenantBySubscriptionId(subscriptionId: string): Promise<{ id: string; slug: string; status: string } | null> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT id, slug, status FROM tenants WHERE razorpay_subscription_id=$1`,
    [subscriptionId],
  )
  return r.rows[0] ?? null
}

export async function updateTenantPlan(tenantId: string, opts: {
  planSlug: string
  billingInterval: string
  newSubscriptionId?: string
}): Promise<void> {
  const pool = controlPlanePool()
  const planRow = await pool.query(`SELECT id FROM plans WHERE slug=$1`, [opts.planSlug])
  const planId = planRow.rows[0]?.id ?? null
  await pool.query(
    `UPDATE tenants SET plan_id=$1, billing_interval=$2,
      razorpay_subscription_id=COALESCE($3, razorpay_subscription_id),
      subscription_status=CASE WHEN $3 IS NOT NULL THEN 'created' ELSE subscription_status END,
      updated_at=now() WHERE id=$4`,
    [planId, opts.billingInterval, opts.newSubscriptionId ?? null, tenantId],
  )
}

export async function setTenantInstanceState(tenantId: string, state: 'running' | 'stopped'): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE tenants SET instance_state=$1, updated_at=now() WHERE id=$2`, [state, tenantId])
}
/** Write resolved infra pointers after provisioning. */
/**
 * Record a step outcome that happened outside the provisioning worker — the Route linked
 * account is created at KYC approval, not by a job. Without this the only trace was a stderr
 * line, which the next blue-green deploy discarded, so a failure could not be diagnosed after
 * the fact. Attaches to the tenant's most recent job (job_id is NOT NULL) and never throws.
 */
export async function recordTenantStepEvent(
  tenantId: string,
  step: string,
  status: 'ok' | 'error',
  message: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await controlPlanePool().query(
      `INSERT INTO provisioning_step_events (job_id, tenant_id, step, status, message, detail)
       SELECT j.id, $1, $2, $3, $4, $5::jsonb
         FROM provisioning_jobs j WHERE j.tenant_id = $1
         ORDER BY j.created_at DESC LIMIT 1`,
      [tenantId, step, status, message, JSON.stringify(detail)],
    )
  } catch { /* a log line must never fail the operation it describes */ }
}

export async function writeTenantInfra(tenantId: string, infra: { rdsEndpoint: string; s3Bucket: string }): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_infra SET rds_endpoint=$1, s3_bucket=$2, iam_auth=true, updated_at=now() WHERE tenant_id=$3`,
    [infra.rdsEndpoint, infra.s3Bucket, tenantId])
}

/** Null the infra pointers after deprovisioning (resources deleted). */
export async function clearTenantInfra(tenantId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_infra SET rds_endpoint=NULL, ec2_instance_id=NULL, updated_at=now() WHERE tenant_id=$1`,
    [tenantId])
  clearTenantCache()
}

/**
 * Permanently purge a deprovisioned tenant: preserve the owner's Razorpay linked account, delete
 * both S3 backup copies, then DELETE the tenant row (cascades to all tenant-scoped tables). The
 * owners row and the owner-scoped tenant_bank_accounts row are intentionally kept so a returning
 * owner can reuse their existing Route account. No restore after this.
 *
 * Refuses a tenant that still has live infra — the caller must deprovision first.
 */
export async function purgeTenant(tenantId: string): Promise<{ ok: boolean; error?: string; deletedBackups?: number }> {
  const pool = controlPlanePool()
  const tenant = await getTenant(tenantId)
  if (!tenant) return { ok: false, error: 'Tenant not found' }
  if (tenant.rds_endpoint || (tenant.status !== 'terminated' && tenant.status !== 'deprovisioned')) {
    return { ok: false, error: 'Tenant must be deprovisioned before it can be deleted' }
  }

  const ownerRow = await pool.query(
    `SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId],
  ).catch(() => null)
  const ownerId: string | null = ownerRow?.rows[0]?.owner_id ?? null

  if (ownerId && tenant.razorpay_linked_account_id) {
    await persistLinkedAccountToOwnerBank(ownerId, tenant.razorpay_linked_account_id)
  }

  // Delhivery has no delete for a client warehouse — deactivate the pickup address so the purged
  // store's origin stops being usable. Deprovision already does this; repeated here so a purge of
  // a tenant deprovisioned before that change (or a partial teardown) still retires it.
  if (ownerId) {
    const draft = await getDraft(ownerId).catch(() => null)
    const pickupName = (draft?.data as any)?.wh?.pickupLocation || tenant.slug
    const { deactivateDelhiveryPickupLocation } = await import('./delhivery')
    await deactivateDelhiveryPickupLocation(pickupName).catch(() => {})
  }

  let deletedBackups = 0
  if (ownerId) {
    const { deleteTenantBackups } = await import('./tenant-backup-store')
    const res = await deleteTenantBackups({ ownerId, slug: tenant.slug })
    deletedBackups = res.deleted
  }

  await pool.query(`DELETE FROM tenants WHERE id=$1`, [tenantId])
  clearTenantCache()
  return { ok: true, deletedBackups }
}

/** Platform-wide infra KV (e.g. the shared pool EC2 instance id/ip). */
export async function getPlatformInfra(key: string): Promise<string | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT value FROM platform_infra WHERE key=$1`, [key])
  return r.rows[0]?.value ?? null
}

export async function setPlatformInfra(key: string, value: string | null): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO platform_infra (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [key, value])
}

/** Persist a tenant's serving EC2 target (dedicated instance IP or pool IP) + optional instance id. */
export async function writeTenantEc2(tenantId: string, ec2Target: string, ec2InstanceId?: string | null): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_infra SET ec2_target=$1, ec2_instance_id=COALESCE($2, ec2_instance_id), updated_at=now() WHERE tenant_id=$3`,
    [ec2Target, ec2InstanceId ?? null, tenantId])
}

// ── Owner accounts (ecom store owners) ───────────────────────────────────────

export interface Owner { id: string; email: string; name: string | null; created_at: string }

/** Upsert an owner by email (used by OTP/Google owner auth — verification already done). */
export async function findOrCreateOwner(email: string, name: string | null): Promise<Owner> {
  const pool = controlPlanePool()
  const existing = await pool.query(`SELECT id, email, name, created_at FROM owners WHERE email=$1`, [email])
  if (existing.rows[0]) {
    if (name && !existing.rows[0].name) {
      await pool.query(`UPDATE owners SET name=$1, updated_at=now() WHERE id=$2`, [name, existing.rows[0].id])
      existing.rows[0].name = name
    }
    return existing.rows[0] as Owner
  }
  const res = await pool.query(
    `INSERT INTO owners (email, name) VALUES ($1, $2) RETURNING id, email, name, created_at`, [email, name])
  return res.rows[0] as Owner
}

/** Set the owner's name from what they entered at onboarding. Sign-in only fills a blank name,
 * so this value is not overwritten by a later login. */
export async function updateOwnerName(ownerId: string, name: string): Promise<void> {
  await controlPlanePool().query(`UPDATE owners SET name=$1, updated_at=now() WHERE id=$2`, [name, ownerId])
}

export async function getOwnerById(id: string): Promise<Owner | null> {
  const pool = controlPlanePool()
  const res = await pool.query(`SELECT id, email, name, created_at FROM owners WHERE id=$1`, [id])
  return (res.rows[0] as Owner) || null
}

/** Tenants owned by an owner. */
export async function getOwnerTenants(ownerId: string): Promise<TenantRow[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, t.custom_domain, t.display_name, t.status, t.daily_payout, t.own_delhivery, t.own_razorpay, t.created_at,
            t.billing_interval, t.razorpay_subscription_id, t.razorpay_checkout_url, t.subscription_status,
            t.razorpay_linked_account_id, t.noreply_email, t.campaign_email,
            p.slug AS plan, p.monthly_price_inr, COALESCE(p.max_custom_domains, 0) AS max_custom_domains,
            i.rds_endpoint, i.s3_bucket, i.ec2_target, i.region
     FROM owner_tenants ot
     JOIN tenants t ON t.id = ot.tenant_id
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE ot.owner_id = $1 ORDER BY t.created_at DESC`, [ownerId])
  return res.rows as TenantRow[]
}

export interface TenantOwner extends Owner {
  role: string
  linked_at: string
}

/** Owners of a tenant — the reverse of getOwnerTenants, for the admin object page. */
export async function getTenantOwners(tenantId: string): Promise<TenantOwner[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT o.id, o.email, o.name, o.created_at, ot.role, ot.created_at AS linked_at
     FROM owner_tenants ot
     JOIN owners o ON o.id = ot.owner_id
     WHERE ot.tenant_id = $1
     ORDER BY ot.created_at`, [tenantId])
  return res.rows as TenantOwner[]
}

/** Link an owner to a tenant they created. */
export async function linkOwnerTenant(ownerId: string, tenantId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1, $2)
     ON CONFLICT (owner_id, tenant_id) DO NOTHING`, [ownerId, tenantId])
}

// ── Bank accounts (payout verification) ──────────────────────────────────────

export interface BankAccount {
  id: string; owner_id: string; verification_status: string
  account_number: string | null; ifsc: string | null; holder_name: string | null
  upi_id: string | null; verified_name: string | null
}

/** Upsert + record a verified/failed bank account for an owner. */
export async function saveBankVerification(args: {
  ownerId: string
  accountNumber?: string | null; ifsc?: string | null; holderName?: string | null; upiId?: string | null
  status: 'pending' | 'initiated' | 'verified' | 'unverified' | 'failed'; ref?: string | null; verifiedName?: string | null
}): Promise<BankAccount> {
  const pool = controlPlanePool()
  // Upsert: one active bank record per owner (no tenant_id yet during onboarding).
  const res = await pool.query(
    `INSERT INTO tenant_bank_accounts
       (owner_id, account_number, ifsc, holder_name, upi_id, verification_status, verification_ref, verified_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (owner_id) DO UPDATE SET
       account_number=EXCLUDED.account_number, ifsc=EXCLUDED.ifsc,
       holder_name=EXCLUDED.holder_name, upi_id=EXCLUDED.upi_id,
       verification_status=EXCLUDED.verification_status,
       verification_ref=COALESCE(EXCLUDED.verification_ref, tenant_bank_accounts.verification_ref),
       verified_name=COALESCE(EXCLUDED.verified_name, tenant_bank_accounts.verified_name),
       updated_at=now()
     RETURNING id, owner_id, verification_status, account_number, ifsc, holder_name, upi_id, verified_name`,
    [args.ownerId, args.accountNumber || null, args.ifsc || null, args.holderName || null, args.upiId || null,
     args.status, args.ref || null, args.verifiedName || null])
  return res.rows[0] as BankAccount
}

/** The owner's current bank account (for gating go-live). */
/**
 * The owner's bank alongside the linked account of whichever store it settles to. Used by the
 * dashboard to show verification state, and by a re-verify to know which Route account to push
 * the corrected details at — Razorpay refuses a second linked account on the same email, so a
 * correction must update the existing one rather than create another.
 */
export async function getOwnerBankWithRoute(ownerId: string): Promise<{
  accountNumber: string | null
  ifsc: string | null
  holderName: string | null
  verifiedName: string | null
  verificationStatus: string | null
  verificationRef: string | null
  linkedAccountId: string | null
  tenantSlug: string | null
} | null> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT b.account_number, b.ifsc, b.holder_name, b.verified_name,
            b.verification_status, b.verification_ref,
            COALESCE(b.linked_account_id, t.razorpay_linked_account_id) AS linked_account_id,
            t.slug AS tenant_slug
       FROM tenant_bank_accounts b
       LEFT JOIN owner_tenants ot ON ot.owner_id = b.owner_id
       LEFT JOIN tenants t ON t.id = ot.tenant_id AND t.status = 'active'
      WHERE b.owner_id = $1
      ORDER BY b.created_at DESC LIMIT 1`, [ownerId])
  const row = r.rows[0]
  if (!row) return null
  return {
    accountNumber: row.account_number ?? null,
    ifsc: row.ifsc ?? null,
    holderName: row.holder_name ?? null,
    verifiedName: row.verified_name ?? null,
    verificationStatus: row.verification_status ?? null,
    verificationRef: row.verification_ref ?? null,
    linkedAccountId: row.linked_account_id ?? null,
    tenantSlug: row.tenant_slug ?? null,
  }
}

export async function getOwnerBankAccount(ownerId: string): Promise<BankAccount | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT id, owner_id, verification_status, account_number, ifsc, holder_name, upi_id, verified_name
     FROM tenant_bank_accounts WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1`, [ownerId])
  return (res.rows[0] as BankAccount) || null
}

/**
 * The payout account for a store. Rows carry both owner_id and tenant_id, and the tenant one is
 * what the operator wants: an owner with several stores can have a different account per store.
 */
export async function getTenantBankAccount(tenantId: string): Promise<BankAccount | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT id, owner_id, verification_status, account_number, ifsc, holder_name, upi_id, verified_name
     FROM tenant_bank_accounts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [tenantId])
  return (res.rows[0] as BankAccount) || null
}

/**
 * Whether the owner has bank details we can settle to.
 *
 * 'verified' means a penny-drop confirmed the holder name. 'unverified' means the details are
 * well-formed but no penny-drop ran — which is the normal case here, because that check needs
 * RazorpayX and this platform settles through Route. Both pass: Razorpay validates the account
 * for real when the Route linked account is configured, so gating go-live on a penny-drop we
 * cannot perform would block every store. 'pending' and 'failed' do not pass.
 */
export async function hasVerifiedBank(ownerId: string): Promise<boolean> {
  const status = (await getOwnerBankAccount(ownerId))?.verification_status
  return status === 'verified' || status === 'unverified'
}

// ── Plan comparison (data-driven from plan_features) ─────────────────────────

// Human-readable comparison rows: each maps to a representative scope key. A plan
// "has" the feature if its plan_features includes that key (checked live).
export const COMPARISON_ROWS: { group: string; label: string; scopeKey: string | null }[] = [
  { group: 'Storefront', label: 'Full storefront (catalogue, cart, checkout)', scopeKey: null }, // null = all plans
  { group: 'Storefront', label: 'Wishlist & product compare', scopeKey: null },
  { group: 'Storefront', label: 'Cash on delivery', scopeKey: null },
  { group: 'Catalogue', label: 'Products & categories', scopeKey: 'products:read' },
  { group: 'Catalogue', label: 'Brands', scopeKey: 'brands:read' },
  { group: 'Catalogue', label: 'AI catalogue enrichment', scopeKey: 'catalog_enrichment:read' },
  { group: 'Catalogue', label: 'Google/Amazon channel sync', scopeKey: 'merchant_sync:read' },
  { group: 'Sales', label: 'Orders & fulfilment', scopeKey: 'orders:read' },
  { group: 'Sales', label: 'Invoices & cash sale', scopeKey: 'invoices:read' },
  { group: 'Sales', label: 'Quotations', scopeKey: 'quotations:read' },
  { group: 'Sales', label: 'Returns & replacements', scopeKey: 'returns:read' },
  { group: 'Sales', label: 'CRM & tasks', scopeKey: 'crm:read' },
  { group: 'Fulfilment', label: 'Packing slips & labels', scopeKey: 'packing_slips:read' },
  { group: 'Fulfilment', label: 'Delhivery pickup scheduling', scopeKey: 'delhivery:read' },
  { group: 'Fulfilment', label: 'QuickScan (mobile)', scopeKey: 'quick_scan:read' },
  { group: 'Finance', label: 'Inventory & purchase orders', scopeKey: 'inventory:read' },
  { group: 'Finance', label: 'Warehouse shelving', scopeKey: 'shelving:read' },
  { group: 'Finance', label: 'GST compliance & filing', scopeKey: 'gst:read' },
  { group: 'Finance', label: 'Financial reports & payouts', scopeKey: 'financial:read' },
  { group: 'Marketing', label: 'Coupons & reviews', scopeKey: 'coupons:read' },
  { group: 'Marketing', label: 'Email mailer & campaigns', scopeKey: 'mailer:read' },
  { group: 'Marketing', label: 'Traffic analytics', scopeKey: 'traffic:read' },
  { group: 'AI & B2B', label: 'AI admin assistant', scopeKey: 'agent:read' },
  { group: 'AI & B2B', label: 'B2B partner portal & RFQs', scopeKey: 'business_customers:read' },
  { group: 'Platform', label: 'Audit log & service accounts', scopeKey: 'audit:read' },
]

/** Which scope keys each plan has (for the comparison table). */
export async function planFeatureMatrix(): Promise<Record<string, Set<string>>> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT p.slug, pf.scope_key FROM plan_features pf JOIN plans p ON p.id = pf.plan_id`)
  const matrix: Record<string, Set<string>> = {}
  for (const r of res.rows) {
    (matrix[r.slug] ||= new Set()).add(r.scope_key)
  }
  return matrix
}

// ── Onboarding drafts ─────────────────────────────────────────────────────────

export interface OnboardingDraft {
  id: string
  owner_id: string
  current_step: number
  data: Record<string, any>
  status: string
  updated_at: string
}

export async function saveDraft(ownerId: string, step: number, data: Record<string, any>): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO onboarding_drafts (owner_id, current_step, data)
     VALUES ($1, $2, $3)
     ON CONFLICT (owner_id) DO UPDATE
       SET current_step = $2, data = $3, updated_at = now()
     WHERE onboarding_drafts.status = 'draft'`,
    [ownerId, step, JSON.stringify(data)],
  )
}

export async function getDraft(ownerId: string): Promise<OnboardingDraft | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT * FROM onboarding_drafts WHERE owner_id=$1`, [ownerId])
  return r.rows[0] ?? null
}

export async function markDraftSubmitted(ownerId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`UPDATE onboarding_drafts SET status='submitted', updated_at=now() WHERE owner_id=$1`, [ownerId])
}

// ── Tenant KYC ────────────────────────────────────────────────────────────────

export interface TenantKyc {
  id: string
  tenant_id: string
  owner_id: string
  gst_number: string | null
  gst_cert_s3_key: string | null
  pan: string | null
  business_name: string | null
  business_type: string | null
  business_address: string | null
  product_categories: string | null
  mobile: string | null
  logo_s3_key: string | null
  seal_s3_key: string | null
  legals_accepted_version: string | null
  legals_accepted_at: string | null
  status: string
  reviewer_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export async function saveKyc(tenantId: string, ownerId: string, kyc: {
  gst_number?: string | null; gst_cert_s3_key?: string | null; pan?: string | null
  business_name?: string | null; business_type?: string | null; business_address?: string | null
  product_categories?: string | null; mobile?: string | null
  logo_s3_key?: string | null; seal_s3_key?: string | null; legals_accepted?: boolean
}): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO tenant_kyc (tenant_id, owner_id, gst_number, gst_cert_s3_key, pan, business_name, business_type, business_address, product_categories, mobile, logo_s3_key, seal_s3_key, legals_accepted_version, legals_accepted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (tenant_id) DO UPDATE SET
       gst_number=EXCLUDED.gst_number, gst_cert_s3_key=COALESCE(EXCLUDED.gst_cert_s3_key, tenant_kyc.gst_cert_s3_key),
       pan=EXCLUDED.pan, business_name=EXCLUDED.business_name, business_type=EXCLUDED.business_type,
       business_address=EXCLUDED.business_address, product_categories=EXCLUDED.product_categories,
       mobile=COALESCE(EXCLUDED.mobile, tenant_kyc.mobile),
       logo_s3_key=COALESCE(EXCLUDED.logo_s3_key, tenant_kyc.logo_s3_key),
       seal_s3_key=COALESCE(EXCLUDED.seal_s3_key, tenant_kyc.seal_s3_key),
       legals_accepted_version=COALESCE(EXCLUDED.legals_accepted_version, tenant_kyc.legals_accepted_version),
       legals_accepted_at=COALESCE(EXCLUDED.legals_accepted_at, tenant_kyc.legals_accepted_at),
       updated_at=now()`,
    [tenantId, ownerId, kyc.gst_number ?? null, kyc.gst_cert_s3_key ?? null, kyc.pan ?? null,
     kyc.business_name ?? null, kyc.business_type ?? null, kyc.business_address ?? null, kyc.product_categories ?? null,
     kyc.mobile ?? null, kyc.logo_s3_key ?? null, kyc.seal_s3_key ?? null,
     kyc.legals_accepted ? (process.env.POLICY_VERSION || '1') : null,
     kyc.legals_accepted ? new Date().toISOString() : null],
  )
}

export async function getKyc(tenantId: string): Promise<TenantKyc | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT * FROM tenant_kyc WHERE tenant_id=$1`, [tenantId])
  return r.rows[0] ?? null
}

export async function approveKyc(tenantId: string, reviewerEmail: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_kyc SET status='approved', reviewed_by=$2, reviewed_at=now(), updated_at=now() WHERE tenant_id=$1`,
    [tenantId, reviewerEmail],
  )
  // Approved but NOT paid yet → 'awaiting_payment'. The provisioning ENGINE (and 'provisioning'
  // status) only starts after subscription.charged — never before payment.
  await pool.query(
    `UPDATE tenants SET status='awaiting_payment', updated_at=now() WHERE id=$1`,
    [tenantId],
  )
}

export async function rejectKyc(tenantId: string, reviewerEmail: string, note: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_kyc SET status='rejected', reviewed_by=$2, reviewed_at=now(), reviewer_note=$3, updated_at=now() WHERE tenant_id=$1`,
    [tenantId, reviewerEmail, note],
  )
  await pool.query(
    `UPDATE tenants SET status='rejected', updated_at=now() WHERE id=$1`,
    [tenantId],
  )
}

// ── Social accounts + scheduled posts (Meta auto-posting) ─────────────────────

export interface TenantSocialAccount {
  id: string
  tenant_id: string
  provider: 'facebook' | 'instagram'
  page_id: string | null
  page_name: string | null
  ig_user_id: string | null
  access_token_enc: string
  token_expiry: string | null
  status: string
}

/** Upsert a tenant's connected Meta account (one row per provider). Token is already encrypted. */
export async function saveTenantSocialAccount(a: {
  tenantId: string
  provider: 'facebook' | 'instagram'
  pageId?: string | null
  pageName?: string | null
  igUserId?: string | null
  accessTokenEnc: string
  tokenExpiry?: Date | null
}): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO tenant_social_accounts
       (tenant_id, provider, page_id, page_name, ig_user_id, access_token_enc, token_expiry, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'connected')
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       page_id=EXCLUDED.page_id, page_name=EXCLUDED.page_name, ig_user_id=EXCLUDED.ig_user_id,
       access_token_enc=EXCLUDED.access_token_enc, token_expiry=EXCLUDED.token_expiry,
       status='connected', updated_at=now()`,
    [a.tenantId, a.provider, a.pageId ?? null, a.pageName ?? null, a.igUserId ?? null,
     a.accessTokenEnc, a.tokenExpiry ? a.tokenExpiry.toISOString() : null],
  )
}

export async function getTenantSocialAccounts(tenantId: string): Promise<TenantSocialAccount[]> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT * FROM tenant_social_accounts WHERE tenant_id=$1`, [tenantId])
  return r.rows as TenantSocialAccount[]
}

export interface ScheduledSocialPost {
  id: string
  tenant_id: string | null
  product_id: string | null
  platform: 'fb' | 'ig' | 'ig_reel'
  caption: string | null
  hashtags: string | null
  image_url: string | null
  image_urls: string[] | null
  video_url: string | null
  scheduled_at: string
  status: string
  posted_id: string | null
  last_error: string | null
  attempts: number
}

/** Queue a post. scheduled_at defaults to now (post-ASAP) when omitted. tenantId null = Jeffi platform. */
export async function enqueueSocialPost(p: {
  tenantId: string | null
  productId?: string | null
  platform: 'fb' | 'ig' | 'ig_reel'
  caption?: string | null
  hashtags?: string | null
  imageUrl?: string | null
  imageUrls?: string[] | null
  videoUrl?: string | null
  scheduledAt?: Date | null
}): Promise<ScheduledSocialPost> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `INSERT INTO scheduled_social_posts
       (tenant_id, product_id, platform, caption, hashtags, image_url, image_urls, video_url, scheduled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, now())) RETURNING *`,
    [p.tenantId, p.productId ?? null, p.platform, p.caption ?? null, p.hashtags ?? null,
     p.imageUrl ?? null, p.imageUrls?.length ? p.imageUrls : null, p.videoUrl ?? null,
     p.scheduledAt ? p.scheduledAt.toISOString() : null],
  )
  return r.rows[0] as ScheduledSocialPost
}

/** Posts whose scheduled time has arrived and are still pending. */
export async function dueSocialPosts(limit = 20): Promise<ScheduledSocialPost[]> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT * FROM scheduled_social_posts
     WHERE status='pending' AND scheduled_at <= now()
     ORDER BY scheduled_at ASC LIMIT $1`, [limit],
  )
  return r.rows as ScheduledSocialPost[]
}

/** Jeffi platform posts (tenant_id IS NULL) for the admin Social Posts list. */
export async function listJeffiSocialPosts(limit = 100): Promise<ScheduledSocialPost[]> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT * FROM scheduled_social_posts
     WHERE tenant_id IS NULL
     ORDER BY scheduled_at DESC LIMIT $1`, [limit],
  )
  return r.rows as ScheduledSocialPost[]
}

/** Social posts for a given scope: a tenant's own queue when tenantId is set, else the Jeffi
 * platform queue (tenant_id IS NULL). Keyed so a tenant admin never sees the platform feed and
 * vice-versa — the tenant is resolved from ALS by the caller, never from the client. */
export async function listSocialPostsForScope(tenantId: string | null, limit = 100): Promise<ScheduledSocialPost[]> {
  const pool = controlPlanePool()
  const r = tenantId
    ? await pool.query(
        `SELECT * FROM scheduled_social_posts
         WHERE tenant_id = $1
         ORDER BY scheduled_at DESC LIMIT $2`, [tenantId, limit],
      )
    : await pool.query(
        `SELECT * FROM scheduled_social_posts
         WHERE tenant_id IS NULL
         ORDER BY scheduled_at DESC LIMIT $1`, [limit],
      )
  return r.rows as ScheduledSocialPost[]
}

/** Load a single scheduled post by id (used by the admin "Post now" action). */
export async function getSocialPost(id: string): Promise<ScheduledSocialPost | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT * FROM scheduled_social_posts WHERE id=$1`, [id])
  return (r.rows[0] as ScheduledSocialPost) || null
}

export async function updateSocialPost(
  id: string,
  patch: { status?: string; postedId?: string | null; lastError?: string | null; caption?: string; bumpAttempts?: boolean },
): Promise<void> {
  const pool = controlPlanePool()
  const sets: string[] = ['updated_at = now()']
  const args: any[] = []
  if (patch.status !== undefined) { args.push(patch.status); sets.push(`status=$${args.length}`) }
  if (patch.postedId !== undefined) { args.push(patch.postedId); sets.push(`posted_id=$${args.length}`) }
  if (patch.lastError !== undefined) { args.push(patch.lastError); sets.push(`last_error=$${args.length}`) }
  if (patch.caption !== undefined) { args.push(patch.caption); sets.push(`caption=$${args.length}`) }
  if (patch.bumpAttempts) sets.push('attempts = attempts + 1')
  args.push(id)
  await pool.query(`UPDATE scheduled_social_posts SET ${sets.join(', ')} WHERE id=$${args.length}`, args)
}

// ── Integration credentials (Google Merchant / Amazon Seller / …) ──────────────

export interface IntegrationCredential {
  id: string
  tenant_id: string
  provider: string
  label: string | null
  config_enc: string
  meta: Record<string, any>
  status: string
  expires_at: string | null
}

/** Upsert a tenant's encrypted credential for a provider (one row per provider). */
export async function saveIntegrationCredential(c: {
  tenantId: string
  provider: string
  label?: string | null
  configEnc: string
  meta?: Record<string, any>
  expiresAt?: Date | null
}): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO tenant_integration_credentials
       (tenant_id, provider, label, config_enc, meta, expires_at, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'connected')
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       label=EXCLUDED.label, config_enc=EXCLUDED.config_enc, meta=EXCLUDED.meta,
       expires_at=EXCLUDED.expires_at, status='connected', updated_at=now()`,
    [c.tenantId, c.provider, c.label ?? null, c.configEnc,
     JSON.stringify(c.meta ?? {}), c.expiresAt ? c.expiresAt.toISOString() : null],
  )
}

export async function getIntegrationCredential(tenantId: string, provider: string): Promise<IntegrationCredential | null> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT * FROM tenant_integration_credentials WHERE tenant_id=$1 AND provider=$2`, [tenantId, provider])
  return (r.rows[0] as IntegrationCredential) ?? null
}

/** List a tenant's integrations WITHOUT the encrypted secret (safe for API/UI). */
export async function listIntegrationCredentials(tenantId: string): Promise<Array<Omit<IntegrationCredential, 'config_enc'>>> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT id, tenant_id, provider, label, meta, status, expires_at
     FROM tenant_integration_credentials WHERE tenant_id=$1 ORDER BY provider`, [tenantId])
  return r.rows
}

export async function deleteIntegrationCredential(tenantId: string, provider: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `DELETE FROM tenant_integration_credentials WHERE tenant_id=$1 AND provider=$2`, [tenantId, provider])
}

// ── Custom domains (BYO CNAME) ────────────────────────────────────────────────

export interface CustomDomain {
  id: string
  tenant_id: string
  domain: string
  status: string
  verification_token: string | null
  cert_arn: string | null
  verified_at: string | null
  created_at: string
}

export async function listCustomDomains(tenantId: string): Promise<CustomDomain[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT id, tenant_id, domain, status, verification_token, cert_arn, verified_at, created_at
     FROM tenant_custom_domains WHERE tenant_id=$1 ORDER BY created_at ASC`, [tenantId])
  return res.rows
}

/** Add a custom domain — enforces the plan's max_custom_domains quota. */
export async function addCustomDomain(tenantId: string, domain: string): Promise<{ ok: true; domain: CustomDomain } | { ok: false; error: string }> {
  const pool = controlPlanePool()
  const clean = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(clean)) return { ok: false, error: 'Invalid domain format' }
  if (clean.endsWith('.jeffistores.in')) return { ok: false, error: 'Cannot use a jeffistores.in subdomain as a custom domain' }

  // Quota check
  const quotaRes = await pool.query(
    `SELECT COALESCE(p.max_custom_domains, 0) AS max, COUNT(cd.id) AS used
     FROM tenants t
     LEFT JOIN plans p ON p.id = t.plan_id
     LEFT JOIN tenant_custom_domains cd ON cd.tenant_id = t.id
     WHERE t.id = $1
     GROUP BY p.max_custom_domains`, [tenantId])
  const q = quotaRes.rows[0]
  const max = Number(q?.max ?? 0)
  const used = Number(q?.used ?? 0)
  if (max === 0) return { ok: false, error: 'Custom domains are available on Pro plan and above' }
  if (used >= max) return { ok: false, error: `Domain limit reached (${max} for your plan)` }

  // Uniqueness
  const dup = await pool.query(`SELECT 1 FROM tenant_custom_domains WHERE domain=$1`, [clean])
  if (dup.rows[0]) return { ok: false, error: 'This domain is already registered' }

  const token = 'jeffi-verify-' + Math.random().toString(36).slice(2, 14)
  const res = await pool.query(
    `INSERT INTO tenant_custom_domains (tenant_id, domain, status, verification_token)
     VALUES ($1, $2, 'pending', $3)
     RETURNING id, tenant_id, domain, status, verification_token, cert_arn, verified_at, created_at`,
    [tenantId, clean, token])
  clearTenantCache()
  return { ok: true, domain: res.rows[0] }
}

/** Mark a custom domain verified (called after DNS CNAME check passes). */
export async function setCustomDomainStatus(id: string, status: string, certArn?: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE tenant_custom_domains
     SET status=$1, cert_arn=COALESCE($2, cert_arn),
         verified_at=CASE WHEN $1='verified' THEN now() ELSE verified_at END,
         updated_at=now()
     WHERE id=$3`, [status, certArn ?? null, id])
  clearTenantCache()
}

export async function getCustomDomain(id: string): Promise<CustomDomain | null> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT id, tenant_id, domain, status, verification_token, cert_arn, verified_at, created_at
     FROM tenant_custom_domains WHERE id=$1`, [id])
  return res.rows[0] ?? null
}

export async function deleteCustomDomain(id: string, tenantId: string): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(`DELETE FROM tenant_custom_domains WHERE id=$1 AND tenant_id=$2`, [id, tenantId])
  clearTenantCache()
}
