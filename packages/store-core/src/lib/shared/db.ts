import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import path from 'path'
import fs from 'fs'
import { createPgPool, rdsSslOption, rdsIamPassword } from '@/lib/shared/pg-pool'
import { fetchDbSecret } from '@/lib/shared/db-secret'
import { getCurrentAuditActor, getCurrentAuditAdminId, setAuditAdminId, runWithAuditContext, runWithAuditActor } from '@/lib/auth/audit-context'
import { getCurrentTenant, getCurrentTenantId, runWithTenantContext, setTenantContext } from '@/lib/tenancy/tenant-context'
import type { TenantContext as TenantContextType } from '@/lib/tenancy/tenant-context'
import { repoPath } from '@/lib/shared/paths'

// DEFAULT pool = the env-configured DB (the platform's own store, dev, jobs).
// Per-tenant pools live in `tenantPools`, keyed by tenant id, built lazily from
// the tenant's infra (TenantContext). When no tenant is in context, callers use
// the DEFAULT pool exactly as before — single-tenant behavior is unchanged.
const DEFAULT_KEY = '__default__'
// Cache pools on globalThis so Next.js dev / Turbopack hot-reloads (which re-import
// this module) reuse the SAME pools instead of leaking a fresh pg.Pool per reload,
// which otherwise exhausts local Postgres ("too many clients already").
const dbGlobal = globalThis as unknown as { __appPool?: Pool | null; __tenantPools?: Map<string, Pool> }
let pool: Pool | null = dbGlobal.__appPool ?? null
const poolTargets = new WeakMap<Pool, string>()
const tenantPools: Map<string, Pool> = dbGlobal.__tenantPools ?? (dbGlobal.__tenantPools = new Map<string, Pool>())

export { getCurrentAuditAdminId, setAuditAdminId, runWithAuditContext, runWithAuditActor }
export { getCurrentTenant, getCurrentTenantId, runWithTenantContext }
export { ensureTenantContext as resolveRequestTenant }

// The shared pool tuning (sizing, keepalive, maxUses). Credential/target fields
// are merged in per source (DEFAULT env, or a tenant's infra).
function basePoolConfig(): any {
  const workers = parseInt(process.env.WEB_CONCURRENCY || '1', 10)
  // DB_POOL_MAX: the store's share of its database's connections, set per pod from its compute choice.
  const poolMax = Math.max(2, Math.floor((Number(process.env.DB_POOL_MAX) || 15) / workers))
  return {
    max: poolMax,
    // Keep a connection warm so the pool is rarely fully cold. A cold IAM+TLS
    // connect to RDS legitimately takes 0.5–3.3s (measured), so the previous
    // 30s idle timeout + 5s connect timeout combo could wedge the pool: during
    // low traffic every connection went idle-closed, then the next request had
    // to cold-connect and a latency spike past 5s failed it, with nothing to
    // fall back on. Warm keepalive'd connections + a longer connect budget fix that.
    min: 1,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    // Rotate connections before RDS's own idle/lifetime limits can silently kill them.
    maxUses: 7500,
    allowExitOnIdle: false,
  }
}

// Build a pool from the DEFAULT env configuration (unchanged from before).
function buildDefaultPool(): Pool {
  const dbUrl = process.env.DATABASE_URL || ''
  const useIamAuth = process.env.RDS_IAM_AUTH === 'true'
  const config: any = basePoolConfig()

  if (useIamAuth) {
    const host = process.env.RDS_HOST!
    const port = parseInt(process.env.RDS_PORT || '5432', 10)
    const user = process.env.RDS_USER!
    const dbName = process.env.RDS_DB!
    const region = process.env.AWS_REGION || 'us-east-1'
    config.host = host
    config.port = port
    config.user = user
    config.database = dbName
    config.ssl = rdsSslOption()
    config.password = rdsIamPassword(host, port, user, region)
  } else {
    if (dbUrl.includes('rds.amazonaws.com')) {
      // Strip sslmode/uselibpqcompat from the URL — pg v8 treats sslmode=require as
      // verify-full and overrides our ssl object, causing SELF_SIGNED_CERT_IN_CHAIN.
      // We control TLS entirely via the ssl: { ca } option below.
      const cleanUrl = dbUrl.replace(/[?&](sslmode|uselibpqcompat)=[^&]*/g, '').replace(/[?&]$/, '')
      config.connectionString = cleanUrl
      const certPath = repoPath('certs', 'global-bundle.pem')
      if (!fs.existsSync(certPath)) {
        throw new Error(
          `RDS TLS certificate not found at ${certPath}. Download from https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`
        )
      }
      config.ssl = { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
    } else {
      config.connectionString = dbUrl
    }
  }
  return createPgPool(config)
}

/**
 * A node-mode store's pods get its database password in env (TENANT_DB_PASSWORD, from the store's
 * Postgres Secret): their servers' role can't read jeffi/tenant-db/*. Only for the store it names.
 */
export function podDbPassword(slug: string | undefined): string | undefined {
  const pw = process.env.TENANT_DB_PASSWORD
  return pw && slug && (process.env.TENANT_DB_SLUG || process.env.SERVICE_TENANT_SLUG) === slug ? pw : undefined
}

// Build a pool for a specific tenant from its infra pointers (per-tenant RDS).
function buildTenantPool(infra: NonNullable<ReturnType<typeof getCurrentTenant>>['infra'], slug?: string): Pool {
  if (!infra || !infra.rdsEndpoint) {
    throw new Error('Tenant has no RDS endpoint configured (tenant_infra.rds_endpoint)')
  }
  const config: any = basePoolConfig()
  config.host = infra.rdsEndpoint
  config.port = infra.rdsPort
  config.database = infra.rdsDb
  // Local-dev tenant (own isolated DB on localhost): plain connection, no TLS, no IAM. Guarded on
  // the loopback host so prod/RDS behaviour is untouched. Credentials come from the dev DATABASE_URL.
  const isLocal = infra.rdsEndpoint === 'localhost' || infra.rdsEndpoint === '127.0.0.1'
  if (isLocal && process.env.NODE_ENV !== 'production') {
    try {
      const u = new URL(process.env.DATABASE_URL || '')
      if (u.username) config.user = decodeURIComponent(u.username)
      if (u.password) config.password = decodeURIComponent(u.password)
    } catch {
      /* no creds in DATABASE_URL — rely on PG* env / peer auth */
    }
    config.ssl = false
    return createPgPool(config)
  }
  if (infra.iamAuth) {
    config.ssl = rdsSslOption()
    const user = infra.rdsUser || process.env.RDS_USER || 'app_user'
    config.user = user
    config.password = rdsIamPassword(infra.rdsEndpoint, infra.rdsPort, user, infra.region)
    return createPgPool(config)
  }
  // Password auth: the store's own Postgres on its EC2 node, self-signed TLS (unverified). The
  // password is the pod's env one, else the Secrets Manager secret at db_secret_ref (cached 5 min).
  const envPw = podDbPassword(slug)
  if (!infra.dbSecretRef && !envPw) throw new Error('Tenant has neither IAM auth nor db_secret_ref set')
  const ref = infra.dbSecretRef!
  const region = infra.region
  config.ssl = { rejectUnauthorized: false }
  config.user = infra.rdsUser || 'jeffi'
  config.password = envPw ?? (async () => (await fetchDbSecret(ref, region)).password)
  return createPgPool(config)
}

function getPool(explicitTenant?: TenantContextType | null): Pool {
  // Prefer an explicitly-resolved tenant (from ensureTenantContext) over ALS.
  // enterWith() set inside an async fn does NOT reliably survive the await back
  // to the caller, so relying on getCurrentTenant() here dropped the tenant and
  // fell back to the platform DB. Passing ctx explicitly is the robust path.
  const tenant = explicitTenant ?? getCurrentTenant()
  if (!tenant) {
    if (!pool) {
      pool = buildDefaultPool()
      dbGlobal.__appPool = pool
    }
    return pool
  }
  // Fail closed: falling back to the platform DB here leaks flagship data onto a tenant host.
  if (!tenant.infra || !tenant.infra.rdsEndpoint) {
    throw new Error(
      `Tenant "${tenant.slug}" has no RDS endpoint configured (tenant_infra.rds_endpoint is null) — ` +
        `refusing to fall back to the platform database.`
    )
  }
  // Per-tenant pool, lazily built + cached by tenant id. A store whose database moved (a size change
  // between a shared and its own database) gets a new pool once its context refreshes; the old one closes.
  const key = `${tenant.infra.rdsEndpoint}/${tenant.infra.rdsDb}/${tenant.infra.rdsUser ?? ''}`
  const cached = tenantPools.get(tenant.tenantId)
  if (cached && poolTargets.get(cached) === key) return cached
  const tp = buildTenantPool(tenant.infra, tenant.slug)
  poolTargets.set(tp, key)
  tenantPools.set(tenant.tenantId, tp)
  cached?.end().catch(() => {})
  return tp
}

// The pinned store's infra for the readiness probe: any status (a store being built is probed too).
let storeInfra: { slug: string; ctx: TenantContextType | null; at: number } | null = null

/**
 * SELECT 1 on the database of the store `slug` through the pool its requests use. 'pending' while the
 * store has no database recorded yet.
 */
export async function pingStoreDb(slug: string): Promise<'ok' | 'pending'> {
  if (!storeInfra || storeInfra.slug !== slug || Date.now() - storeInfra.at > 30_000) {
    const { controlPlanePool } = await import('@/lib/tenant-registry')
    const r = (
      await controlPlanePool().query(
        `SELECT t.id, t.slug, t.display_name, i.rds_endpoint, i.rds_db, i.rds_port, i.rds_user, i.db_secret_ref, i.iam_auth, i.s3_bucket, i.region
           FROM tenants t LEFT JOIN tenant_infra i ON i.tenant_id = t.id WHERE t.slug = $1 LIMIT 1`,
        [slug]
      )
    ).rows[0]
    const ctx: TenantContextType | null = r?.rds_endpoint
      ? {
          tenantId: r.id,
          slug: r.slug,
          displayName: r.display_name ?? null,
          plan: null,
          infra: {
            rdsEndpoint: r.rds_endpoint,
            rdsDb: r.rds_db || 'jeffi_stores',
            rdsPort: r.rds_port || 5432,
            rdsUser: r.rds_user ?? null,
            dbSecretRef: r.db_secret_ref ?? null,
            iamAuth: r.iam_auth !== false,
            s3Bucket: r.s3_bucket ?? null,
            region: r.region || 'us-east-1',
          },
        }
      : null
    storeInfra = { slug, ctx, at: Date.now() }
  }
  if (!storeInfra.ctx) return 'pending'
  await getPool(storeInfra.ctx).query('SELECT 1')
  return 'ok'
}

/**
 * Establish the per-request tenant context from the x-tenant-slug header (set by
 * middleware) when the AsyncLocalStorage store is empty. This is REQUIRED because Next.js
 * Edge middleware runs in a separate context from Node route handlers, so the ALS tenant
 * context set in middleware does NOT reach getPool() here — without this bridge every
 * request falls back to the DEFAULT pool (the platform DB), leaking one tenant's traffic
 * onto the main store's data. Resolves the tenant's infra from the control-plane and
 * RETURNS it so callers pass it straight to getPool() — enterWith() alone does not
 * survive the await boundary back into query()/getClient(). Returns null when ALS already
 * has a tenant (jobs), when there's no request scope, or when the header is absent.
 */
async function ensureTenantContext(): Promise<TenantContextType | null> {
  const existing = getCurrentTenant()
  if (existing) return existing
  let slug: string | null = null
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    slug = h.get('x-tenant-slug')
  } catch {
    return null // outside a request scope (jobs) — leave default
  }
  if (!slug) return null
  const { lookupTenantContextBySlug } = await import('@/lib/tenant-registry')
  const ctx = await lookupTenantContextBySlug(slug)
  if (ctx) setTenantContext(ctx)
  return ctx
}

function isMutation(text: string): boolean {
  const t = text.trimStart().toUpperCase()
  return t.startsWith('INSERT') || t.startsWith('UPDATE') || t.startsWith('DELETE')
}

async function getRequestAdminId(): Promise<string | null> {
  const local = getCurrentAuditAdminId()
  if (local) return local
  try {
    const { readAdminSid } = await import('@/lib/auth/admin-cookie')
    const sid = await readAdminSid()
    if (!sid) return null
    // Cookie value is the opaque session id. Dynamic import avoids a db.ts ↔ auth-sessions
    // circular import at module load.
    const { resolveSession } = await import('@/lib/auth/auth-sessions')
    const s = await resolveSession(sid)
    return s && s.principalType === 'admin' ? s.principalId : null
  } catch {
    return null
  }
}

// Who a write is recorded against when no admin made it: an explicit runWithAuditActor, else the
// signed-in customer, else a cron call. Customer sessions are cached briefly to keep writes cheap.
const customerSids = new Map<string, { id: string | null; at: number }>()

export async function requestActor(): Promise<string | null> {
  const explicit = getCurrentAuditActor()
  if (explicit) return explicit
  try {
    const { cookies, headers } = await import('next/headers')
    const jar = await cookies()
    const sid = jar.get('user_sid')?.value || jar.get('business_sid')?.value
    if (sid) {
      const hit = customerSids.get(sid)
      if (hit && Date.now() - hit.at < 60_000) return hit.id && `customer:${hit.id}`
      const { resolveSession } = await import('@/lib/auth/auth-sessions')
      const s = await resolveSession(sid, undefined, { touch: false }).catch(() => null)
      const id = s && s.principalType === 'customer' ? s.principalId : null
      if (customerSids.size > 500) customerSids.clear()
      customerSids.set(sid, { id, at: Date.now() })
      if (id) return `customer:${id}`
    }
    const auth = (await headers()).get('authorization')
    if (auth && process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return 'cron'
  } catch {
    /* outside a request */
  }
  return null
}

// An explicit source (runWithAuditActor) made the change even when an admin's request carried it,
// e.g. a courier status picked up while an admin views tracking.
async function requestAudit(): Promise<{ adminId: string | null; actor: string | null }> {
  const explicit = getCurrentAuditActor()
  if (explicit) return { adminId: null, actor: explicit }
  const adminId = await getRequestAdminId()
  return { adminId, actor: adminId ? null : await requestActor() }
}

const SET_AUDIT = `SELECT set_config('audit.admin_id', $1, $3), set_config('audit.actor', $2, $3)`

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const tenant = await ensureTenantContext()
  const p = getPool(tenant)
  if (isMutation(text)) {
    const { adminId, actor } = await requestAudit()
    if (adminId || actor) {
      const client = await p.connect()
      try {
        await client.query('BEGIN')
        await client.query(SET_AUDIT, [adminId ?? '', actor ?? '', true])
        const result = await client.query<T>(text, params)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    }
  }
  return p.query<T>(text, params)
}

export async function queryOne<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await query<T>(text, params)
  return result.rows[0] || null
}

export async function queryMany<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await query<T>(text, params)
  return result.rows
}

export async function queryCount(text: string, params?: any[]): Promise<number> {
  const result = await query(text, params)
  return parseInt(result.rows[0]?.count || '0', 10)
}

export async function getClient(): Promise<PoolClient> {
  const tenant = await ensureTenantContext()
  const client = await getPool(tenant).connect()
  const { adminId, actor } = await requestAudit()
  if (adminId || actor) {
    await client.query(SET_AUDIT, [adminId ?? '', actor ?? '', false]).catch(() => {})
    const originalRelease = client.release.bind(client)
    ;(client as any).release = (err?: Error | boolean) => {
      client
        .query(SET_AUDIT, ['', '', false])
        .catch(() => {})
        .finally(() => {
          originalRelease(err as any)
        })
    }
  }
  return client
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { adminId, actor } = await requestAudit()
    if (adminId || actor) await client.query(SET_AUDIT, [adminId ?? '', actor ?? '', true])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
