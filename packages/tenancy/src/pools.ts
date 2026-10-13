import pg from 'pg'
import path from 'node:path'
import fs from 'node:fs'
import { Signer } from '@aws-sdk/rds-signer'
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
    Object.assign(config, { host, port, user, database: process.env.CONTROL_PLANE_RDS_DB || 'jeffi_control_plane', ssl: rdsSslOption(), password: rdsIamPassword(host, port, user, process.env.AWS_REGION || 'us-east-1') })
  } else {
    config.connectionString = url
    if (url.includes('rds.amazonaws.com')) config.ssl = rdsSslOption()
  }
  cp = createPgPool(config)
  return cp
}

function basePoolConfig(): any {
  const workers = parseInt(process.env.WEB_CONCURRENCY || '1', 10)
  return {
    max: Math.max(2, Math.floor(15 / workers)),
    min: 1,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    maxUses: 7500,
    allowExitOnIdle: false,
  }
}

function buildTenantPool(infra: TenantInfra): pg.Pool {
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
  config.ssl = rdsSslOption()
  if (!infra.iamAuth) throw new Error('Password-auth tenant pools not implemented; use IAM auth')
  const user = process.env.RDS_USER || 'app_user'
  config.user = user
  config.password = rdsIamPassword(infra.rdsEndpoint, infra.rdsPort, user, infra.region)
  return createPgPool(config)
}

const tenantPools = new Map<string, pg.Pool>()
export function tenantPool(t: TenantContext): pg.Pool {
  if (!t.infra?.rdsEndpoint) throw new Error(`Tenant "${t.slug}" has no RDS endpoint configured`)
  let p = tenantPools.get(t.tenantId)
  if (!p) {
    p = buildTenantPool(t.infra)
    tenantPools.set(t.tenantId, p)
  }
  return p
}
