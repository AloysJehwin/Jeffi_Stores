import { Pool } from 'pg'
import path from 'path'
import fs from 'fs'
import { Signer } from '@aws-sdk/rds-signer'
import type { TenantContext } from '../tenant-context'

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
  'admin',
  'business',
  'forms',
  'www',
  'ecom',
  'invoice',
  'quotation',
  'purchaseorder',
  'api',
  'app',
  'mail',
  'static',
  'assets',
  'cdn',
  'certificate',
])

export const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

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
    } catch {
      /* leave url empty; the guard below throws a clear error */
    }
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
  p.on('error', () => {
    /* idle-client error — pool self-heals */
  })
  cpGlobal.__cpPool = p
  return p
}
