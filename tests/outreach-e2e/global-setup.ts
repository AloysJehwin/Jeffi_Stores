// A platform-admin session for the controller (tests/ui-kit/session.ts, the same engine the UI tests use), on
// jeffi_test only. Skipped quietly when no test DB is configured: the spec then skips with the reason.
import { runTsx } from '../responsive/tsx'
import { loadLocalEnv } from '../responsive/env'

export default async function globalSetup(): Promise<void> {
  loadLocalEnv()
  const url = process.env.DATABASE_URL
  if (!url || !/test/i.test(new URL(url).pathname)) {
    process.env.OUTREACH_E2E_SETUP_SKIPPED = 'DATABASE_URL does not point at jeffi_test'
    return
  }
  try {
    runTsx('tests/ui-kit/session.ts', ['controller'])
  } catch (e) {
    process.env.OUTREACH_E2E_SETUP_SKIPPED = `could not mint the admin session: ${(e as Error).message}`
  }
}
