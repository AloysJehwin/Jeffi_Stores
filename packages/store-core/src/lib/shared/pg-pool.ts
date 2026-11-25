import { Pool, PoolConfig } from 'pg'
import path from 'path'
import fs from 'fs'
import { Signer } from '@aws-sdk/rds-signer'
import { repoPath } from '@/lib/shared/paths'

// The single place `new pg.Pool` is constructed. Every DB module builds its own
// config object (sizing, target, credentials are caller-owned and unchanged) and
// hands it here. The idle-client error listener is attached once, centrally: it
// keeps an idle-socket error from crashing the process as an unhandled 'error'
// event. pg has already evicted the bad client by the time it fires, so the pool
// self-heals and the handler deliberately does nothing.
export function createPgPool(config: PoolConfig): Pool {
  const pool = new Pool(config)
  pool.on('error', () => {
    /* idle-client error — pool already evicted it; no action needed */
  })
  return pool
}

function rdsCertPath(): string {
  return repoPath('certs', 'global-bundle.pem')
}

// RDS requires TLS. When the CA bundle is present we verify the chain against it;
// otherwise fall back to an unverified connection (local/dev over a tunnel).
export function rdsSslOption(): PoolConfig['ssl'] {
  const certPath = rdsCertPath()
  return fs.existsSync(certPath)
    ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
    : { rejectUnauthorized: false }
}

/**
 * TLS from config, not the hostname: `disable`, `require` (encrypted, unverified) or `verify` (against
 * `ca`: a CA bundle path, relative to the repo root, or inline PEM; the system roots without one).
 * undefined when `mode` is unset, so callers keep their RDS-host default.
 */
export function sslFromConfig(mode: string | undefined, ca?: string): PoolConfig['ssl'] | undefined {
  const m = (mode || '').trim().toLowerCase()
  if (!m) return undefined
  if (['disable', 'off', 'false', '0', 'no'].includes(m)) return false
  if (['require', 'on', 'true', '1', 'yes', 'prefer'].includes(m)) return { rejectUnauthorized: false }
  if (!['verify', 'verify-full', 'verify-ca'].includes(m)) throw new Error(`DB_SSL must be disable, require or verify (got "${mode}")`)
  if (!ca) return { rejectUnauthorized: true }
  if (ca.trimStart().startsWith('-----BEGIN')) return { rejectUnauthorized: true, ca }
  const p = path.isAbsolute(ca) ? ca : repoPath(ca)
  if (!fs.existsSync(p)) throw new Error(`DB_SSL_CA file not found: ${p}`)
  return { rejectUnauthorized: true, ca: fs.readFileSync(p).toString() }
}

/** The platform database's TLS: DB_SSL + DB_SSL_CA (Azure Flexible Server: verify). */
export const dbSslConfig = () => sslFromConfig(process.env.DB_SSL, process.env.DB_SSL_CA)

/** A postgres URL without TLS params: pg lets the URL's sslmode override the ssl object. */
export function stripSslParams(url: string): string {
  try {
    const u = new URL(url)
    for (const k of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return url
  }
}

// RDS IAM auth: pg calls this per connection to mint a short-lived auth token in
// place of a stored password.
export function rdsIamPassword(host: string, port: number, user: string, region: string): () => Promise<string> {
  const signer = new Signer({ hostname: host, port, region, username: user })
  return () => signer.getAuthToken()
}
