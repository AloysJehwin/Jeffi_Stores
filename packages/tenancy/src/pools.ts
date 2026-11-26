import pg from 'pg'
import path from 'node:path'
import fs from 'node:fs'
import { Signer } from '@aws-sdk/rds-signer'
// The shared secrets interface (Secrets Manager or Key Vault): plain ESM so the boot loader uses it too.
import { fetchDbSecret } from '../../store-core/src/lib/secrets/index.mjs'
import type { TenantContext, TenantInfra } from './context'

export function createPgPool(config: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool(config)
  pool.on('error', () => {})
  return pool
}

export function rdsSslOption(): pg.PoolConfig['ssl'] {
  const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
  const alt = path.join(process.cwd(), '..', 'certs', 'global-bundle.pem')
  const p = fs.existsSync(certPath) ? certPath : fs.existsSync(alt) ? alt : null
  return p ? { rejectUnauthorized: true, ca: fs.readFileSync(p).toString() } : { rejectUnauthorized: false }
}

// Platform-database TLS by config, as store-core's pg-pool: DB_SSL=disable|require|verify, DB_SSL_CA a CA
// bundle path (or inline PEM) for verify, else the system roots. Unset: undefined, the RDS-host default applies.
export function sslFromConfig(mode: string | undefined, ca?: string): pg.PoolConfig['ssl'] | undefined {
  const m = (mode || '').trim().toLowerCase()
  if (!m) return undefined
  if (['disable', 'off', 'false', '0', 'no'].includes(m)) return false
  if (['require', 'on', 'true', '1', 'yes', 'prefer'].includes(m)) return { rejectUnauthorized: false }
  if (!['verify', 'verify-full', 'verify-ca'].includes(m)) throw new Error(`DB_SSL must be disable, require or verify (got "${mode}")`)
  if (!ca) return { rejectUnauthorized: true }
  if (ca.trimStart().startsWith('-----BEGIN')) return { rejectUnauthorized: true, ca }
  const p = path.resolve(ca)
  if (!fs.existsSync(p)) throw new Error(`DB_SSL_CA file not found: ${p}`)
  return { rejectUnauthorized: true, ca: fs.readFileSync(p).toString() }
}

export const dbSslConfig = () => sslFromConfig(process.env.DB_SSL, process.env.DB_SSL_CA)

export function rdsIamPassword(host: string, port: number, user: string, region: string): () => Promise<string> {
  const signer = new Signer({ hostname: host, port, region, username: user })
  return () => signer.getAuthToken()
}

let cp: pg.Pool | null = null
export function controlPlanePool(): pg.Pool {
  if (cp) return cp
  let url = process.env.CONTROL_PLANE_DATABASE_URL || ''
  const iam = process.env.CONTROL_PLANE_IAM_AUTH === 'true'
  // Control-plane tables live in the unified app DB (docs/MICROSERVICES.md); no separate DB.
  if (!url && !iam && process.env.DATABASE_URL) url = process.env.DATABASE_URL
  if (!url && !iam) throw new Error('Control-plane DB not configured: set CONTROL_PLANE_DATABASE_URL')
  const config: any = { max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000, keepAlive: true }
  if (iam) {
    const host = process.env.CONTROL_PLANE_RDS_HOST!
    const port = parseInt(process.env.CONTROL_PLANE_RDS_PORT || '5432', 10)
    const user = process.env.CONTROL_PLANE_RDS_USER || 'app_user'
    Object.assign(config, { host, port, user, database: process.env.CONTROL_PLANE_RDS_DB || 'jeffi_stores', ssl: dbSslConfig() ?? rdsSslOption(), password: rdsIamPassword(host, port, user, process.env.AWS_REGION || 'us-east-1') })
  } else {
    cp = mainPool(url, 3)
    return cp
  }
  cp = createPgPool(config)
  return cp
}

/**
 * A pool on the main app DB from a postgres URL. TLS from DB_SSL / DB_SSL_CA, else RDS hosts get TLS with
 * the RDS CA; DB_IAM_AUTH=true signs an IAM token per connection instead of the URL's password. Built from
 * parts so `sslmode` in the URL can't override the CA.
 */
export function mainPool(url: string, max = 10): pg.Pool {
  const u = new URL(url)
  const port = Number(u.port || 5432)
  const user = decodeURIComponent(u.username)
  const config: any = { ...basePoolConfig(), max, host: u.hostname, port, database: decodeURIComponent(u.pathname.slice(1)), user }
  if (u.password) config.password = decodeURIComponent(u.password)
  const ssl = dbSslConfig()
  if (ssl !== undefined) config.ssl = ssl
  else if (u.hostname.toLowerCase().endsWith('.rds.amazonaws.com')) config.ssl = rdsSslOption()
  if (process.env.DB_IAM_AUTH === 'true') config.password = rdsIamPassword(u.hostname, port, user, process.env.AWS_REGION || 'us-east-1')
  return createPgPool(config)
}

export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

let platform: pg.Pool | null = null
/** The platform store has no tenant_infra: its rows live in the main app DB (docs/MICROSERVICES.md). */
export function platformPool(): pg.Pool {
  if (platform) return platform
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  platform = mainPool(url)
  return platform
}

function basePoolConfig(): any {
  const workers = parseInt(process.env.WEB_CONCURRENCY || '1', 10)
  return {
    max: Math.max(2, Math.floor((Number(process.env.DB_POOL_MAX) || 15) / workers)),
    min: 1,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    maxUses: 7500,
    allowExitOnIdle: false,
  }
}

// A node-mode store's pods get its database password in env (from its Postgres Secret): their
// servers' role can't read jeffi/tenant-db/*. Only for the store it names.
function podDbPassword(slug: string): string | undefined {
  const pw = process.env.TENANT_DB_PASSWORD
  return pw && (process.env.TENANT_DB_SLUG || process.env.SERVICE_TENANT_SLUG) === slug ? pw : undefined
}

function buildTenantPool(infra: TenantInfra, slug: string): pg.Pool {
  if (!infra.rdsEndpoint) throw new Error('Tenant has no RDS endpoint configured (tenant_infra.rds_endpoint)')
  const config: any = { ...basePoolConfig(), host: infra.rdsEndpoint, port: infra.rdsPort, database: infra.rdsDb }
  const isLocal = infra.rdsEndpoint === 'localhost' || infra.rdsEndpoint === '127.0.0.1'
  if (isLocal && process.env.NODE_ENV !== 'production') {
    try {
      const u = new URL(process.env.DATABASE_URL || '')
      if (u.username) config.user = decodeURIComponent(u.username)
      if (u.password) config.password = decodeURIComponent(u.password)
    } catch {}
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
  // password is the pod's env one, else the secret at db_secret_ref (cached 5 min).
  const envPw = podDbPassword(slug)
  if (!infra.dbSecretRef && !envPw) throw new Error('Tenant has neither IAM auth nor db_secret_ref set')
  const ref = infra.dbSecretRef!
  const region = infra.region
  config.ssl = { rejectUnauthorized: false }
  config.user = infra.rdsUser || 'jeffi'
  config.password = envPw ?? (async () => (await fetchDbSecret(ref, region)).password)
  return createPgPool(config)
}

const tenantPools = new Map<string, { key: string; pool: pg.Pool }>()
export function tenantPool(t: TenantContext): pg.Pool {
  if (!t.infra?.rdsEndpoint) throw new Error(`Tenant "${t.slug}" has no RDS endpoint configured`)
  // Rebuilt when the store's database moves (a size change between a shared and its own database).
  const key = `${t.infra.rdsEndpoint}/${t.infra.rdsDb}/${t.infra.rdsUser ?? ''}`
  const cached = tenantPools.get(t.tenantId)
  if (cached?.key === key) return cached.pool
  const pool = buildTenantPool(t.infra, t.slug)
  tenantPools.set(t.tenantId, { key, pool })
  cached?.pool.end().catch(() => {})
  return pool
}
