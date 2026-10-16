/* eslint-disable no-console */
// Create a fully LOCAL tenant for testing — own isolated Postgres DB on localhost, registered in
// the local control plane and activated. No AWS. Mirrors a real tenant's schema via the same
// buildTenantSchemaSql() the provisioner uses.
//
//   npx tsx scripts/local-tenant.ts <slug> [--plan basic|growth|pro|enterprise] [--own-delhivery] [--own-razorpay] [--drop]
//
// Then open (with `npm run dev` running):
//   http://<slug>.localhost:3000           storefront
//   http://admin-<slug>.localhost:3000      admin  (set up an admin user — see output)
//
// LOCAL ONLY. Reads DATABASE_URL for the local Postgres connection; never touches RDS.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import pg from 'pg'
import { buildTenantSchemaSql } from '@/lib/tenant-migrations-schema'

const { Client } = pg

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

const slug = process.argv[2]
if (!slug || slug.startsWith('--')) {
  console.error('Usage: npx tsx scripts/local-tenant.ts <slug> [--plan basic] [--own-delhivery] [--own-razorpay] [--drop]')
  process.exit(1)
}
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
  console.error(`Invalid slug "${slug}" — lowercase letters, digits and hyphens only.`)
  process.exit(1)
}

const base = process.env.DATABASE_URL
if (!base) {
  console.error('DATABASE_URL is not set (local Postgres).')
  process.exit(1)
}
const u = new URL(base)
if (!['localhost', '127.0.0.1'].includes(u.hostname)) {
  console.error(`Refusing to run: DATABASE_URL host is "${u.hostname}", not localhost. This script is local-only.`)
  process.exit(1)
}
const host = u.hostname
const port = Number(u.port || '5432')
const plan = arg('plan') || 'basic'
const tenantDb = `jeffi_tenant_${slug.replace(/-/g, '_')}`
const controlDb = 'jeffi_control_plane'

const connect = (database: string) =>
  new Client({ host, port, user: decodeURIComponent(u.username || ''), password: decodeURIComponent(u.password || ''), database })

async function main() {
  // 1. (re)create the tenant DB
  const admin = connect('postgres')
  await admin.connect()
  if (has('drop')) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(tenantDb)} WITH (FORCE)`)
    console.log(`· dropped ${tenantDb}`)
  }
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [tenantDb])
  if (exists.rowCount) {
    console.log(`· tenant DB ${tenantDb} already exists — reusing (pass --drop to recreate)`)
  } else {
    await admin.query(`CREATE DATABASE ${quoteIdent(tenantDb)}`)
    console.log(`· created tenant DB ${tenantDb}`)
  }
  await admin.end()

  // 2. load the real tenant schema (same builder the provisioner uses)
  const t = connect(tenantDb)
  await t.connect()
  await t.query(buildTenantSchemaSql())
  console.log(`· loaded tenant schema into ${tenantDb}`)
  await t.end()

  // 3. register + activate in the control plane
  const cp = connect(controlDb)
  await cp.connect()
  const planRow = await cp.query(`SELECT id FROM plans WHERE slug = $1`, [plan])
  if (!planRow.rowCount) throw new Error(`Plan "${plan}" not found in ${controlDb}.`)
  const planId = planRow.rows[0].id

  const tenant = await cp.query(
    `INSERT INTO tenants (slug, display_name, plan_id, status, own_delhivery, own_razorpay, instance_state)
     VALUES ($1, $2, $3, 'active', $4, $5, 'running')
     ON CONFLICT (slug) DO UPDATE SET
       display_name = EXCLUDED.display_name, plan_id = EXCLUDED.plan_id, status = 'active',
       own_delhivery = EXCLUDED.own_delhivery, own_razorpay = EXCLUDED.own_razorpay, updated_at = now()
     RETURNING id`,
    [slug, titleCase(slug), planId, has('own-delhivery'), has('own-razorpay')]
  )
  const tenantId = tenant.rows[0].id

  await cp.query(
    `INSERT INTO tenant_infra (tenant_id, rds_endpoint, rds_db, rds_port, iam_auth, region, s3_bucket)
     VALUES ($1, 'localhost', $2, $3, false, 'local', NULL)
     ON CONFLICT (tenant_id) DO UPDATE SET
       rds_endpoint = 'localhost', rds_db = EXCLUDED.rds_db, rds_port = EXCLUDED.rds_port,
       iam_auth = false, region = 'local', s3_bucket = NULL, updated_at = now()`,
    // No tenant bucket locally: uploads fall back to S3_BUCKET_NAME under the local S3_KEY_PREFIX.
    [tenantId, tenantDb, port]
  )
  await cp.end()

  console.log(`\n✓ local tenant "${slug}" (${plan}) active — tenant_id ${tenantId}`)
  console.log(`  delivery: ${has('own-delhivery') ? 'own account (COD on)' : 'platform account (wallet; no COD)'}`)
  console.log(`  razorpay: ${has('own-razorpay') ? 'own keys' : 'platform Route'}`)
  console.log(`\nOpen (with npm run dev):`)
  console.log(`  http://${slug}.localhost:3000`)
  console.log(`  http://admin-${slug}.localhost:3000`)
  console.log(`  http://invoice-${slug}.localhost:3000`)
  console.log(`\nNo admin user exists yet in the tenant DB. Create one:`)
  console.log(`  npx tsx scripts/local-tenant-admin.ts ${slug} <email>`)
}

function quoteIdent(id: string) {
  if (!/^[a-z0-9_]+$/.test(id)) throw new Error(`unsafe identifier: ${id}`)
  return `"${id}"`
}
function titleCase(s: string) {
  return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

main().catch(e => {
  console.error('FAILED:', e?.message || e)
  process.exit(1)
})
