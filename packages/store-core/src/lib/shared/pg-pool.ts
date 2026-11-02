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
  // Password-auth path (tenant Postgres on the store's own node with a self-signed TLS cert):
  // when a password is supplied by env or the caller's config, run TLS unverified. IAM auth
  // sets `password` to a function and its own ssl, so that path is untouched.
  const envPw = process.env.JEFFI_DB_PASSWORD
  if (envPw && !config.password) config = { ...config, password: envPw }
  if (typeof config.password === 'string' && config.password && config.ssl === undefined) {
    config = { ...config, ssl: { rejectUnauthorized: false } }
  }
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

// RDS IAM auth: pg calls this per connection to mint a short-lived auth token in
// place of a stored password.
export function rdsIamPassword(host: string, port: number, user: string, region: string): () => Promise<string> {
  const signer = new Signer({ hostname: host, port, region, username: user })
  return () => signer.getAuthToken()
}
