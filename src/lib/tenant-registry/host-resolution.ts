import type { TenantContext } from '../tenant-context'
import { controlPlanePool, RESERVED_LABELS, ROOT_DOMAIN } from './shared'

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
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  )
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

export { formsHostForSlug, formsHostForHost } from '../forms-host'

async function lookupTenant(where: 'slug' | 'custom_domain', value: string): Promise<TenantContext | null> {
  const pool = controlPlanePool()
  // For custom_domain, resolve via the tenant_custom_domains table (verified only),
  // falling back to the legacy tenants.custom_domain column for backward compat.
  const whereClause =
    where === 'custom_domain'
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
    [tenantId]
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

