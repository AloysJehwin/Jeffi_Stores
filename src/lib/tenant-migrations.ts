import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import { createPgPool, rdsSslOption } from './pg-pool'
import { controlPlanePool } from './tenant-registry'
import { buildTenantSchemaSql, desiredTableColumns } from './tenant-migrations-schema'

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

/**
 * Build a short-lived pool to a tenant's RDS as the MASTER user (password auth).
 *
 * The fan-out runs DDL (CREATE TABLE/EXTENSION, ALTER, …). app_user is granted privileges
 * on existing tables/sequences at provisioning time but NOT CREATE on schema public, so
 * connecting via IAM as app_user fails with "permission denied for schema public" the
 * moment the schema tries to create a new object. Provisioning's own loadSchema connects
 * as the master user for exactly this reason (aws-provider.tenantPool) — mirror that here.
 */
function tenantPool(infra: { rdsEndpoint: string; rdsPort: number; rdsDb: string }): Pool {
  const masterUser = process.env.TENANT_RDS_MASTER_USER || 'postgres'
  const masterPassword = process.env.RDS_MASTER_PASSWORD
  if (!masterPassword) {
    throw new Error(
      'RDS_MASTER_PASSWORD is not set — required to connect as the tenant DB master user for the schema fan-out'
    )
  }
  return createPgPool({
    host: infra.rdsEndpoint,
    port: infra.rdsPort,
    database: infra.rdsDb,
    user: masterUser,
    password: masterPassword,
    ssl: rdsSslOption(),
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

// Connection-level failures that a second attempt can reasonably clear; anything else is a real
// schema problem and retrying would only repeat it.
const TRANSIENT_PG_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '57P01',
  '57P02',
  '57P03',
  '53300',
  '53400',
])
const TRANSIENT_MESSAGE =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|timeout|Connection terminated|server closed the connection/i
const RETRY_DELAY_MS = 3000

export function isTransientDbError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (!e) return false
  if (e.code && TRANSIENT_PG_CODES.has(e.code)) return true
  return TRANSIENT_MESSAGE.test(String(e.message || ''))
}

/**
 * One multi-statement query gives Postgres no way to say WHICH statement failed, so name it
 * here: `position` is the 1-based character offset the server reports for the failing token
 * (an error inside a DO block reports the block's inner statement via internalQuery instead).
 */
export function describeSqlError(err: unknown, sql: string): string {
  const e = err as {
    message?: string
    code?: string
    position?: string | number
    internalQuery?: string
    where?: string
  } | null
  const base = String(e?.message ?? err)
  const code = e?.code ? ` (code ${e.code})` : ''
  const pos = Number(e?.position)
  let near = ''
  if (Number.isFinite(pos) && pos > 0 && pos <= sql.length) {
    const start = Math.max(0, sql.lastIndexOf(';', pos - 2) + 1)
    const end = sql.indexOf(';', pos - 1)
    near = sql.slice(start, end === -1 ? undefined : end + 1)
  } else if (e?.internalQuery) {
    near = e.internalQuery
  }
  near = near
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (near.length > 220) near = `${near.slice(0, 220)}...`
  return near ? `${base}${code} near: ${near}` : `${base}${code}`
}

/** Columns the schema files declare that the live database still lacks, as "table.column". */
export function missingColumns(desired: Map<string, string[]>, live: Map<string, Set<string>>): string[] {
  const missing: string[] = []
  for (const [table, cols] of desired) {
    const have = live.get(table)
    if (!have) {
      missing.push(`${table}.*`)
      continue
    }
    for (const c of cols) if (!have.has(c)) missing.push(`${table}.${c}`)
  }
  return missing
}

async function liveColumns(pool: Pool): Promise<Map<string, Set<string>>> {
  const res = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  )
  const map = new Map<string, Set<string>>()
  for (const r of res.rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, new Set())
    map.get(r.table_name)!.add(r.column_name)
  }
  return map
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Apply the schema to one tenant and prove it landed. The batch is one implicit transaction
 * (a multi-statement simple query with no explicit BEGIN/COMMIT), so a failure leaves the
 * database as it was. A transient connection error gets exactly one retry; a real schema error
 * is reported with the statement that raised it. Afterwards the live column list is compared
 * with what the files declare, so a column the reconciliation could not add is a failure here
 * instead of a silent gap discovered at request time.
 */
export async function applySchemaToTenant(
  pool: Pool,
  schemaSql: string,
  desired: Map<string, string[]>
): Promise<void> {
  let attempt = 0
  for (;;) {
    attempt++
    try {
      await pool.query(schemaSql)
      break
    } catch (err) {
      if (attempt === 1 && isTransientDbError(err)) {
        await sleep(RETRY_DELAY_MS)
        continue
      }
      throw new Error(describeSqlError(err, schemaSql))
    }
  }
  const missing = missingColumns(desired, await liveColumns(pool))
  if (missing.length > 0) {
    throw new Error(
      `post-apply verification: ${missing.length} column(s) still missing: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', ...' : ''}`
    )
  }
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
  const desired = desiredTableColumns()

  for (const t of targets) {
    if (await alreadyApplied(t.id, gitSha)) {
      result.skipped++
      continue
    }

    let pool: Pool | null = null
    try {
      pool = tenantPool({ rdsEndpoint: t.rds_endpoint, rdsPort: t.rds_port || 5432, rdsDb: t.rds_db || 'jeffi_stores' })
      await applySchemaToTenant(pool, schemaSql, desired)
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

interface MigrationFile {
  filename: string
  sql: string
}

/** Read database/migrations/*.sql in filename order (mirrors deploy/run-migrations.sh). */
function readMigrationFiles(): MigrationFile[] {
  const dir = path.join(process.cwd(), 'database', 'migrations')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(filename => ({ filename, sql: fs.readFileSync(path.join(dir, filename), 'utf8') }))
}

const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`

/**
 * Apply pending database/migrations/*.sql files to every active tenant's own RDS.
 *
 * The desired-state fan-out (runMigrationFanout) only re-applies the topic schema; migration
 * files that carry data fixes or one-off DDL never reached tenants — the deploy applied them to
 * the flagship alone. This mirrors deploy/run-migrations.sh per tenant: each tenant DB has its
 * own schema_migrations ledger, and only files absent from it are applied, so re-runs are
 * naturally idempotent and a failure on one tenant is isolated (recorded, not fatal to the rest).
 *
 * Not gated on git_sha: the pending set is derived from each DB's ledger, so a new migration added
 * under a SHA already recorded still applies.
 */
export async function runMigrationFilesFanout(gitSha: string): Promise<FanoutResult> {
  const targets = await listActiveTenantTargets()
  const files = readMigrationFiles()
  const result: FanoutResult = { gitSha, total: targets.length, applied: 0, skipped: 0, failed: 0, failures: [] }
  if (files.length === 0) return result

  for (const t of targets) {
    let pool: Pool | null = null
    try {
      pool = tenantPool({ rdsEndpoint: t.rds_endpoint, rdsPort: t.rds_port || 5432, rdsDb: t.rds_db || 'jeffi_stores' })
      await pool.query(SCHEMA_MIGRATIONS_DDL)
      const doneRes = await pool.query('SELECT filename FROM schema_migrations')
      const done = new Set<string>(doneRes.rows.map((r: { filename: string }) => r.filename))

      const pending = files.filter(f => !done.has(f.filename))
      if (pending.length === 0) {
        result.skipped++
        continue
      }

      for (const f of pending) {
        await pool.query(f.sql)
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f.filename])
      }
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
  git_sha: string
  status: string
  error: string | null
  ran_at: string
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
export async function getMigrationRuns(limit = 100): Promise<
  Array<{
    tenant_id: string
    slug: string
    git_sha: string
    status: string
    error: string | null
    ran_at: string
  }>
> {
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
