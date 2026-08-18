import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

/**
 * Optional starter-data seeding for a freshly-provisioned tenant DB.
 *
 * By DESIGN a new tenant store is EMPTY — `load_schema` installs the schema with zero
 * rows and the owner adds their own catalog. This module exists only for the opt-in case
 * where a provisioning job carries a `seedProfile` (e.g. a demo/starter catalog); it is
 * never invoked on the default path. Keeping it separate from `load_schema` means "empty
 * store" stays the guaranteed default and seeding can never run by accident.
 *
 * Add profiles here as they're defined. An unknown profile throws (a terminal error, so
 * the state machine fails + rolls back) rather than silently activating a mis-seeded store.
 */

const KNOWN_PROFILES = new Set<string>([
  // 'demo-catalog',  // ← define + implement before enabling
])

/** Build a master-auth pool to the tenant DB (same auth as aws-provider's tenantPool). */
function tenantMasterPool(endpoint: string, dbName: string): Pool {
  const masterPassword = process.env.RDS_MASTER_PASSWORD
  if (!masterPassword) throw new Error('RDS_MASTER_PASSWORD is not set — required to seed a tenant DB')
  const user = process.env.TENANT_RDS_MASTER_USER || process.env.RDS_MASTER_USER || 'postgres'
  const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
  const ssl = fs.existsSync(certPath)
    ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
    : { rejectUnauthorized: false }
  return new Pool({ host: endpoint, port: 5432, database: dbName, user, password: masterPassword, ssl, max: 2, connectionTimeoutMillis: 20000 })
}

/**
 * Seed a tenant DB with the given profile. No-op-safe seam: currently no profiles are
 * implemented, so any profile throws until one is defined. Called by the `seed_data`
 * provisioning step only when a job explicitly carries `seedProfile`.
 */
export async function seedTenantData(endpoint: string, dbName: string, profile: string): Promise<void> {
  if (!KNOWN_PROFILES.has(profile)) {
    throw new Error(`seed_data: unknown seedProfile '${profile}' (no seeder implemented)`)
  }
  const pool = tenantMasterPool(endpoint, dbName)
  try {
    // Per-profile seeding SQL goes here, e.g.:
    // if (profile === 'demo-catalog') await pool.query(DEMO_CATALOG_SQL)
    void pool
  } finally {
    await pool.end().catch(() => {})
  }
}
