import type { Pool } from 'pg'
import { createPgPool, rdsSslOption } from '@/lib/shared/pg-pool'
import { fetchDbSecret } from '@/lib/shared/db-secret'

// One way for the controller to reach a store's database as its admin, whichever kind it is:
//  - node mode (Postgres on the store's own server): superuser `jeffi`, password from Secrets Manager
//    (or the one provisioning just generated), self-signed TLS;
//  - localhost (local dev tenants): the DATABASE_URL server's credentials, no TLS;
//  - RDS: the master user with RDS TLS.

export const TENANT_DB_NAME = 'jeffi_stores'
export const NODE_DB_USER = 'jeffi'
export const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
export const tenantDbSecretRef = (slug: string) => `jeffi/tenant-db/${slug}`
export const nodeDbHost = (slug: string) => `${slug}-postgres.tenant-${slug}.svc.cluster.local`
/** The store whose on-node Postgres a host is (nodeDbHost), else null. */
export const nodeDbSlug = (host: string | null | undefined): string | null =>
  /^([a-z0-9-]+)-postgres\.tenant-\1\.svc\.cluster\.local$/.exec(host ?? '')?.[1] ?? null

export interface TenantDbTarget {
  endpoint: string
  port?: number | null
  dbName?: string | null
  /** tenant_infra.iam_auth: false with a secret ref means the store's own on-node Postgres. */
  iamAuth?: boolean | null
  dbSecretRef?: string | null
  /** A password provisioning holds already (skips the Secrets Manager read). */
  dbPassword?: string
}

/** How to log in, when a caller knows more than the endpoint. */
export type DbAuth = Pick<TenantDbTarget, 'iamAuth' | 'dbSecretRef' | 'dbPassword'>

export const isNodeDb = (t: Pick<TenantDbTarget, 'iamAuth' | 'dbSecretRef'>) => t.iamAuth === false && !!t.dbSecretRef
const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1'

/** A target from an endpoint; with no auth given, an on-node Postgres host still logs in as `jeffi`. */
export function dbTarget(endpoint: string, dbName?: string | null, auth?: DbAuth): TenantDbTarget {
  const slug = nodeDbSlug(endpoint)
  if (!auth && slug) return { endpoint, dbName, iamAuth: false, dbSecretRef: tenantDbSecretRef(slug) }
  return { endpoint, dbName, ...auth }
}

export async function tenantAdminPool(t: TenantDbTarget, max = 2): Promise<Pool> {
  const database = t.dbName || TENANT_DB_NAME
  const common = { host: t.endpoint, port: t.port || 5432, database, max, connectionTimeoutMillis: 20000 }
  if (isLoopback(t.endpoint)) {
    const u = new URL(process.env.DATABASE_URL || 'postgresql://localhost:5432/postgres')
    return createPgPool({ ...common, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) || undefined, ssl: false })
  }
  if (isNodeDb(t) || t.dbPassword) {
    const password = t.dbPassword ?? (await fetchDbSecret(t.dbSecretRef!, AWS_REGION)).password
    return createPgPool({ ...common, user: NODE_DB_USER, password, ssl: { rejectUnauthorized: false } })
  }
  const password = process.env.RDS_MASTER_PASSWORD
  if (!password) throw new Error('RDS_MASTER_PASSWORD is not set — required to reach a tenant RDS database')
  // The user CreateDBInstance made (aws-provider); RDS_MASTER_USER is the platform database's.
  const user = process.env.TENANT_RDS_MASTER_USER || 'postgres'
  return createPgPool({ ...common, user, password, ssl: rdsSslOption() })
}

/** Run `fn` on a short-lived admin pool, always closing it. */
export async function withTenantAdminPool<T>(t: TenantDbTarget, fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = await tenantAdminPool(t)
  try {
    return await fn(pool)
  } finally {
    await pool.end().catch(() => {})
  }
}
