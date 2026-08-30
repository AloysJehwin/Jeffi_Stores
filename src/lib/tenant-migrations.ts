import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { Signer } from '@aws-sdk/rds-signer'
import { controlPlanePool } from './tenant-registry'
import { buildTenantSchemaSql } from './tenant-migrations-schema'

/**
 * Multi-tenant schema migration fan-out (Part B of the SaaS plan).
 *
 * Applies the desired-state schema (database/*.sql topic files) to every active
 * tenant's dedicated RDS. The topic files themselves are plain pg_dump output and are NOT
 * idempotent; buildTenantSchemaSql() rewrites them into re-appliable form (see
 * tenant-migrations-schema.ts). That matters because the whole schema is sent as one
 * multi-statement query, which Postgres aborts on first error — before the rewrite, the
 * first already-existing object failed the migration for every tenant that was not brand
 * new. One `tenant_migration_runs` row is written per (tenant, gitSha) so a failure on one
 * tenant is visible and doesn't block the others.
 *
 * Ordering matters: extensions → tables → constraints → indexes → functions → triggers.
 */

/** Build a short-lived pool to a tenant's RDS using IAM auth (mirrors db.ts). */
function tenantPool(infra: { rdsEndpoint: string; rdsPort: number; rdsDb: string; region: string }): Pool {
  const user = process.env.RDS_USER || 'app_user'
  const signer = new Signer({ hostname: infra.rdsEndpoint, port: infra.rdsPort, region: infra.region, username: user })
  const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
  const ssl = fs.existsSync(certPath)
    ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
    : { rejectUnauthorized: false }
  return new Pool({
    host: infra.rdsEndpoint,
    port: infra.rdsPort,
    database: infra.rdsDb,
    user,
    password: () => signer.getAuthToken(),
    ssl,
    max: 2,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
  })
}

interface TenantTarget {
  id: string
  slug: string
  rds_endpoint: string
  rds_port: number
  rds_db: string
  region: string
}

async function listActiveTenantTargets(): Promise<TenantTarget[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT t.id, t.slug, i.rds_endpoint, i.rds_port, i.rds_db, i.region
     FROM tenants t
     JOIN tenant_infra i ON i.tenant_id = t.id
     WHERE t.status = 'active' AND i.rds_endpoint IS NOT NULL`
  )
  return res.rows
}

/** Has this tenant already had this gitSha applied successfully? */
async function alreadyApplied(tenantId: string, gitSha: string): Promise<boolean> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT 1 FROM tenant_migration_runs
     WHERE tenant_id = $1 AND git_sha = $2 AND status = 'success' LIMIT 1`,
    [tenantId, gitSha]
  )
  return res.rows.length > 0
}

async function recordRun(tenantId: string, gitSha: string, status: 'success' | 'failed', error?: string) {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO tenant_migration_runs (tenant_id, git_sha, status, error, ran_at)
     VALUES ($1, $2, $3, $4, now())`,
    [tenantId, gitSha, status, error ?? null]
  )
}

export interface FanoutResult {
  gitSha: string
  total: number
  applied: number
  skipped: number
  failed: number
  failures: { slug: string; error: string }[]
}

/**
 * Apply the current desired-state schema to all active tenant DBs.
 * Idempotent — skips tenants already on this gitSha, safe to re-run.
 */
export async function runMigrationFanout(gitSha: string): Promise<FanoutResult> {
  const targets = await listActiveTenantTargets()
  const result: FanoutResult = { gitSha, total: targets.length, applied: 0, skipped: 0, failed: 0, failures: [] }
  const schemaSql = buildTenantSchemaSql()

  for (const t of targets) {
    if (await alreadyApplied(t.id, gitSha)) { result.skipped++; continue }

    let pool: Pool | null = null
    try {
      pool = tenantPool({ rdsEndpoint: t.rds_endpoint, rdsPort: t.rds_port || 5432, rdsDb: t.rds_db || 'jeffi_stores', region: t.region || 'us-east-1' })
      // Apply the whole schema in one connection. ON_ERROR_STOP semantics via a
      // single multi-statement query — pg aborts the batch on first error.
      await pool.query(schemaSql)
      await recordRun(t.id, gitSha, 'success')
      result.applied++
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      await recordRun(t.id, gitSha, 'failed', msg).catch(() => {})
      result.failed++
      result.failures.push({ slug: t.slug, error: msg })
    } finally {
      if (pool) await pool.end().catch(() => {})
    }
  }

  return result
}

export interface TenantMigrationRun {
  git_sha: string; status: string; error: string | null; ran_at: string
}

/** Migration history for one tenant, newest first — answers "is this store on current code?". */
export async function getTenantMigrationRuns(tenantId: string, limit = 10): Promise<TenantMigrationRun[]> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT git_sha, status, error, ran_at
     FROM tenant_migration_runs WHERE tenant_id = $1
     ORDER BY ran_at DESC LIMIT $2`,
    [tenantId, limit]
  )
  return res.rows as TenantMigrationRun[]
}

/** Admin visibility: latest migration run per tenant. */
export async function getMigrationRuns(limit = 100): Promise<Array<{
  tenant_id: string; slug: string; git_sha: string; status: string; error: string | null; ran_at: string
}>> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT m.tenant_id, t.slug, m.git_sha, m.status, m.error, m.ran_at
     FROM tenant_migration_runs m
     JOIN tenants t ON t.id = m.tenant_id
     ORDER BY m.ran_at DESC LIMIT $1`,
    [limit]
  )
  return res.rows
}
