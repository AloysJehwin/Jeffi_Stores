// Browser UI tests (real Chromium against a running app + seeded jeffi_test), organized per app, per
// component: <app>-service/ui-tests/<component>/*.spec.ts. Pick the app with UI_APP
// (storefront | admin | business | controller | showcase | kit); `kit` runs the no-server self-tests in
// tests/ui-kit. Unset UI_APP keeps the old behaviour: every -service/ui-tests spec at the storefront URL.
//   UI_APP=storefront npm run test:ui
//   UI_APP=storefront npx playwright test -c playwright.ui.config.ts storefront-service/ui-tests/home
// Needs a server at UI_BASE_URL (default http://localhost:<app port>) backed by DATABASE_URL=...jeffi_test
// (seed via scripts/setup-test-db.sh). Separate from the responsive sweep.
import { defineConfig, devices } from '@playwright/test'

// Same ports as DEV_PORTS in scripts/dev-router.ts (not imported: that file starts a server) plus showcase.
const PORTS: Record<string, number> = { storefront: 3010, admin: 3011, business: 3012, controller: 3013, showcase: 3014 }

const app = process.env.UI_APP
if (app && app !== 'kit' && !(app in PORTS)) throw new Error(`UI_APP must be one of ${[...Object.keys(PORTS), 'kit'].join(', ')}; got "${app}"`)

const testMatch = app === 'kit' ? /tests\/ui-kit\/.*\.spec\.ts$/ : app ? new RegExp(`${app}-service/ui-tests/.*\\.spec\\.ts$`) : /-service\/ui-tests\/.*\.spec\.ts$/
const BASE = process.env.UI_BASE_URL || `http://localhost:${PORTS[app && app !== 'kit' ? app : 'storefront']}`

export default defineConfig({
  testDir: '.',
  testMatch,
  globalSetup: './tests/ui-kit/global-setup.ts',
  outputDir: 'tests/ui-output/test-results',
  fullyParallel: false, // one shared store DB; serialize like the api-db tier
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: process.env.CI ? 120_000 : 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE,
    ...devices['Desktop Chrome'],
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
