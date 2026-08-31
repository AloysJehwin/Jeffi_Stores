import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import path from 'path'
import fs from 'fs'
import { Signer } from '@aws-sdk/rds-signer'
import { getCurrentAuditAdminId, setAuditAdminId, runWithAuditContext } from './audit-context'
import { getCurrentTenant, getCurrentTenantId, runWithTenantContext, setTenantContext } from './tenant-context'
import type { TenantContext as TenantContextType } from './tenant-context'

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
const tenantPools: Map<string, Pool> = dbGlobal.__tenantPools ?? (dbGlobal.__tenantPools = new Map<string, Pool>())

export { getCurrentAuditAdminId, setAuditAdminId, runWithAuditContext }
export { getCurrentTenant, getCurrentTenantId, runWithTenantContext }

function makeRdsSigner(host: string, port: number, user: string, region: string): () => Promise<string> {
  const signer = new Signer({ hostname: host, port, region, username: user })
  return () => signer.getAuthToken()
}

// The shared pool tuning (sizing, keepalive, maxUses). Credential/target fields
// are merged in per source (DEFAULT env, or a tenant's infra).
function basePoolConfig(): any {
  const workers = parseInt(process.env.WEB_CONCURRENCY || '1', 10)
  const poolMax = Math.max(2, Math.floor(15 / workers))
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

function rdsSslOption(): any {
  const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
  return fs.existsSync(certPath)
    ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
    : { rejectUnauthorized: false }
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
    config.password = makeRdsSigner(host, port, user, region)
  } else {
    if (dbUrl.includes('rds.amazonaws.com')) {
      // Strip sslmode/uselibpqcompat from the URL — pg v8 treats sslmode=require as
      // verify-full and overrides our ssl object, causing SELF_SIGNED_CERT_IN_CHAIN.
      // We control TLS entirely via the ssl: { ca } option below.
      const cleanUrl = dbUrl.replace(/[?&](sslmode|uselibpqcompat)=[^&]*/g, '').replace(/[?&]$/, '')
      config.connectionString = cleanUrl
      const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
      if (!fs.existsSync(certPath)) {
        throw new Error(`RDS TLS certificate not found at ${certPath}. Download from https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`)
      }
      config.ssl = { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
    } else {
      config.connectionString = dbUrl
    }
  }
  return attachErrorHandler(new Pool(config))
}

// Build a pool for a specific tenant from its infra pointers (per-tenant RDS).
function buildTenantPool(infra: NonNullable<ReturnType<typeof getCurrentTenant>>['infra']): Pool {
  if (!infra || !infra.rdsEndpoint) {
    throw new Error('Tenant has no RDS endpoint configured (tenant_infra.rds_endpoint)')
  }
  const config: any = basePoolConfig()
  config.host = infra.rdsEndpoint
  config.port = infra.rdsPort
  config.database = infra.rdsDb
  config.ssl = rdsSslOption()
  if (infra.iamAuth) {
    const user = process.env.RDS_USER || 'app_user'
    config.user = user
    config.password = makeRdsSigner(infra.rdsEndpoint, infra.rdsPort, user, infra.region)
  } else {
    // Password-based tenants would resolve creds from db_secret_ref; not used on
    // the IAM-first path. Left explicit so the branch is obvious.
    throw new Error('Password-auth tenant pools not yet implemented; use IAM auth')
  }
  return attachErrorHandler(new Pool(config))
}

function attachErrorHandler(p: Pool): Pool {
  // Fires when an *idle* pooled client errors out (e.g. RDS drops the socket).
  // pg has already removed the bad client from the pool by the time this runs,
  // so the pool self-heals on its own. We must keep this listener registered so
  // an idle-client error does not crash the process as an unhandled 'error'
  // event — but we deliberately do NOTHING here.
  p.on('error', () => { /* idle-client error — pool already evicted it; no action needed */ })
  return p
}

function getPool(explicitTenant?: TenantContextType | null): Pool {
  // Prefer an explicitly-resolved tenant (from ensureTenantContext) over ALS.
  // enterWith() set inside an async fn does NOT reliably survive the await back
  // to the caller, so relying on getCurrentTenant() here dropped the tenant and
  // fell back to the platform DB. Passing ctx explicitly is the robust path.
  const tenant = explicitTenant ?? getCurrentTenant()
  if (!tenant) {
    if (!pool) { pool = buildDefaultPool(); dbGlobal.__appPool = pool }
    return pool
  }
  // Fail closed: falling back to the platform DB here leaks flagship data onto a tenant host.
  if (!tenant.infra || !tenant.infra.rdsEndpoint) {
    throw new Error(
      `Tenant "${tenant.slug}" has no RDS endpoint configured (tenant_infra.rds_endpoint is null) — ` +
      `refusing to fall back to the platform database.`
    )
  }
  // Per-tenant pool, lazily built + cached by tenant id.
  let tp = tenantPools.get(tenant.tenantId)
  if (!tp) {
    tp = buildTenantPool(tenant.infra)
    tenantPools.set(tenant.tenantId, tp)
  }
  return tp
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
  const { lookupTenantContextBySlug } = await import('./tenant-registry')
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
    const { readAdminSid } = await import('./admin-cookie')
    const sid = await readAdminSid()
    if (!sid) return null
    // Cookie value is the opaque session id. Dynamic import avoids a db.ts ↔ auth-sessions
    // circular import at module load.
    const { resolveSession } = await import('./auth-sessions')
    const s = await resolveSession(sid)
    return s && s.principalType === 'admin' ? s.principalId : null
  } catch {
    return null
  }
}

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const tenant = await ensureTenantContext()
  const p = getPool(tenant)
  if (isMutation(text)) {
    const adminId = await getRequestAdminId()
    if (adminId) {
      const client = await p.connect()
      try {
        await client.query('BEGIN')
        await client.query(`SELECT set_config('audit.admin_id', $1, true)`, [adminId])
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
  const adminId = await getRequestAdminId()
  if (adminId) {
    await client.query(`SELECT set_config('audit.admin_id', $1, false)`, [adminId]).catch(() => {})
    const originalRelease = client.release.bind(client)
    ;(client as any).release = (err?: Error | boolean) => {
      client.query(`SELECT set_config('audit.admin_id', '', false)`).catch(() => {}).finally(() => {
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
    const adminId = await getRequestAdminId()
    if (adminId) {
      await client.query(`SELECT set_config('audit.admin_id', $1, true)`, [adminId])
    }
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
