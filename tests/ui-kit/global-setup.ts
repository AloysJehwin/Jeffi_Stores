// Mints the signed-in session for admin, controller and business (tests/ui-kit/session.ts, run under tsx like the
// responsive sweep's prepare step). storefront, showcase and kit need none.
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { SESSION_APPS, type SessionApp } from './session'

export default async function globalSetup(): Promise<void> {
  const app = process.env.UI_APP as SessionApp | undefined
  if (!app || !SESSION_APPS.includes(app)) return
  execFileSync(path.join('node_modules', '.bin', 'tsx'), ['--tsconfig', 'tests/responsive/tsconfig.sweep.json', 'tests/ui-kit/session.ts', app], { stdio: 'inherit' })
}
