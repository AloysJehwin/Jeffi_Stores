// @vitest-environment node
//
// Shared harness for DB-backed API tests (the `jeffi_test` tier). Node env — real `pg`, no happy-dom.
// Opt-in: tests gate on API_DB=1 (so the mock integration suite is unaffected on machines without jeffi_test).
// Import db/handlers DYNAMICALLY from the test, AFTER requireTestDb() has pinned a safe DATABASE_URL.
import crypto from 'crypto'

export const API_DB_ENABLED = process.env.API_DB === '1'

// The ONLY database these tests may ever touch. Guards against running against real local data.
const TEST_DB_NAME = 'jeffi_test'

// Refuse to run unless DATABASE_URL points at a database literally named `jeffi_test`.
// Closes the gap in the webhook-replay guard (which checks host:port only, not the db name),
// so the real local `jeffi_production_ready` can never be hit by a mistaken env.
export function requireTestDb(): string {
  const url = process.env.DATABASE_URL || ''
  let name = ''
  try {
    name = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`API_DB tests: DATABASE_URL is not a valid URL: ${JSON.stringify(url)}`)
  }
  if (name !== TEST_DB_NAME) {
    throw new Error(
      `API_DB tests REFUSE to run: DATABASE_URL database must be '${TEST_DB_NAME}', got '${name}'. ` +
        `Run: bash scripts/setup-test-db.sh, then DATABASE_URL=postgresql://$USER@localhost:5432/jeffi_test`
    )
  }
  // Plain local Postgres — never RDS/IAM in tests.
  delete process.env.RDS_IAM_AUTH
  return url
}

// Fixed-id read fixtures from scripts/seed-test-db.sql.
export const FIXTURES = {
  customerId: '00000000-0000-4000-a000-0000000000c1',
  adminUserId: '00000000-0000-4000-a000-0000000000a0',
  adminId: '00000000-0000-4000-a000-0000000000a1',
  product1: '00000000-0000-4000-b000-000000000001',
  product2: '00000000-0000-4000-b000-000000000002',
}

// Unique-ish suffix for per-file seeded rows (parallel-safe without Date.now/Math.random in workflow scripts;
// here in a test file those are fine). Keep ids distinct per file to avoid cross-file collisions.
export function uniqueSuffix(): string {
  return crypto.randomBytes(6).toString('hex')
}
