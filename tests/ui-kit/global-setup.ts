// Mints the signed-in session for admin, controller and business (tests/ui-kit/session.ts, run under tsx like the
// responsive sweep's prepare step). storefront, showcase and kit need none.
import { runTsx } from '../responsive/tsx'
import { SESSION_APPS, type SessionApp } from './session'

export default async function globalSetup(): Promise<void> {
  const app = process.env.UI_APP as SessionApp | undefined
  if (!app || !SESSION_APPS.includes(app)) return
  runTsx('tests/ui-kit/session.ts', [app])
}
