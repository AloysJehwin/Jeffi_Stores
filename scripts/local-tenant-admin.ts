/* eslint-disable no-console */
// Create a super_admin for a LOCAL tenant so you can log in to its admin panel.
//   npx tsx scripts/local-tenant-admin.ts <slug> <email> [name]
// Login is email-OTP (no password). With mail disabled locally the OTP prints to the dev-server
// console; or read it from Redis. LOCAL ONLY — connects to the tenant's own localhost DB.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import pg from 'pg'
import { TENANT_SCOPE_KEYS } from '@/lib/auth/scopes'

const { Client } = pg
const slug = process.argv[2]
const email = process.argv[3]
const name = process.argv[4] || email?.split('@')[0] || 'Owner'
if (!slug || !email) {
  console.error('Usage: npx tsx scripts/local-tenant-admin.ts <slug> <email> [name]')
  process.exit(1)
}
const base = process.env.DATABASE_URL
if (!base) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
const u = new URL(base)
if (!['localhost', '127.0.0.1'].includes(u.hostname)) {
  console.error('Refusing to run: DATABASE_URL is not localhost. Local-only script.')
  process.exit(1)
}
const tenantDb = `jeffi_tenant_${slug.replace(/-/g, '_')}`

async function main() {
  const c = new Client({
    host: u.hostname,
    port: Number(u.port || '5432'),
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    database: tenantDb,
  })
  await c.connect().catch(() => {
    console.error(`Could not connect to ${tenantDb}. Create the tenant first: npx tsx scripts/local-tenant.ts ${slug}`)
    process.exit(1)
  })

  const [firstName, ...rest] = name.split(' ')
  const lastName = rest.join(' ')
  const user = await c.query(
    `INSERT INTO users (email, first_name, last_name, is_active, user_type)
     VALUES ($1, $2, $3, true, 'customer')
     ON CONFLICT (email, user_type) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
     RETURNING id`,
    [email, firstName, lastName]
  )
  const userId = user.rows[0].id
  await c.query(
    `INSERT INTO admins (user_id, role, scopes, is_active)
     VALUES ($1, 'super_admin', $2::jsonb, true)
     ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin', scopes = $2::jsonb, is_active = true`,
    [userId, JSON.stringify(TENANT_SCOPE_KEYS)]
  )
  await c.end()

  console.log(`✓ super_admin ${email} created in ${tenantDb}`)
  console.log(`\nLog in at  http://admin-${slug}.localhost:3000/login`)
  console.log(`Enter ${email}; the OTP prints to the \`npm run dev\` console (local mail is disabled).`)
}

main().catch(e => {
  console.error('FAILED:', e?.message || e)
  process.exit(1)
})
