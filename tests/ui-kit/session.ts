// Mints signed-in sessions for the browser UI tests with the apps' own session engine (createSession), on a test DB
// only, and writes a Playwright storage-state file per app. global-setup.ts runs this under tsx:
//   npx tsx --tsconfig tests/responsive/tsconfig.sweep.json tests/ui-kit/session.ts <admin|controller|business>
// admin: admin_sid for the seeded administrator (scripts/seed-test-db.sql). controller: the same platform session
// (its /admin/ecom pages need role administrator). business: business_sid for the seeded approved business account.
import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from '../responsive/env'

export const SESSION_APPS = ['admin', 'controller', 'business'] as const
export type SessionApp = (typeof SESSION_APPS)[number]

/** Where the app's storage state lives; specs use test.use({ storageState: storageStatePath('admin') }). */
export const storageStatePath = (app: SessionApp) => path.join('tests', 'ui-output', `${app}-state.json`)

const BUSINESS_EMAIL = 'uitest-business@jeffi.test'
const TTL_S = 3600

function assertTestDb(): void {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  // Sessions are written to auth_sessions: never on a real store's DB.
  if (!/test/i.test(new URL(url).pathname)) throw new Error(`refusing to mint sessions on ${new URL(url).pathname.slice(1)}: point DATABASE_URL at jeffi_test`)
}

async function mint(app: SessionApp): Promise<{ name: string; value: string }> {
  const { createSession } = await import('@/lib/auth/auth-sessions')
  const { queryOne } = await import('@/lib/shared/db')
  if (app === 'business') {
    const u = await queryOne<{ id: string }>(
      `SELECT u.id FROM users u JOIN business_profiles b ON b.user_id = u.id WHERE u.email = $1 AND u.user_type = 'business' AND b.approval_status = 'approved'`,
      [BUSINESS_EMAIL]
    )
    if (!u) throw new Error('no approved business account in the DB (seed jeffi_test with scripts/seed-test-db.sql)')
    const { sid } = await createSession({ principalType: 'business', principalId: u.id, ttlSeconds: TTL_S, approvalStatus: 'approved', scopes: [] })
    return { name: 'business_sid', value: sid }
  }
  const admin = await queryOne<{ id: string; role: string }>(`SELECT id, role FROM admins WHERE is_active = true AND role = 'administrator' ORDER BY created_at LIMIT 1`)
  if (!admin) throw new Error('no active administrator in the DB (seed jeffi_test with scripts/seed-test-db.sql)')
  const { sid } = await createSession({ principalType: 'admin', principalId: admin.id, ttlSeconds: TTL_S, role: admin.role, scopes: ['*'] })
  return { name: 'admin_sid', value: sid }
}

export async function writeStorageState(app: SessionApp): Promise<string> {
  assertTestDb()
  const { name, value } = await mint(app)
  const file = storageStatePath(app)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const expires = Math.floor(Date.now() / 1000) + TTL_S
  // Cookies ignore the port, so one state serves every localhost app the session is valid on.
  fs.writeFileSync(file, JSON.stringify({ cookies: [{ name, value, domain: 'localhost', path: '/', expires, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }, null, 2))
  return file
}

if (process.argv[1]?.endsWith('tests/ui-kit/session.ts')) {
  loadLocalEnv()
  const app = process.argv[2] as SessionApp
  if (!SESSION_APPS.includes(app)) {
    console.error(`usage: session.ts ${SESSION_APPS.join('|')}`)
    process.exit(1)
  }
  writeStorageState(app)
    .then(f => {
      process.stdout.write(`[ui-kit] ${app} session written to ${f} on ${new URL(process.env.DATABASE_URL!).pathname.slice(1)}\n`)
      process.exit(0)
    })
    .catch(err => {
      console.error('[ui-kit] session failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
