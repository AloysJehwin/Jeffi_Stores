// Browser UI tests (real Chromium against a running app + seeded jeffi_test), organized per app, per
// component: <app>-service/ui-tests/<component>/*.spec.ts. Run ALL with `npm run test:ui`, or ONE
// component with `npx playwright test --config playwright.ui.config.ts storefront-service/ui-tests/home`.
// Needs a server reachable at UI_BASE_URL (default http://localhost:3010 = storefront) backed by
// DATABASE_URL=...jeffi_test (seed via scripts/setup-test-db.sh). Separate from the responsive sweep.
import { defineConfig, devices } from '@playwright/test'

const BASE = process.env.UI_BASE_URL || 'http://localhost:3010'

export default defineConfig({
  testDir: '.',
  testMatch: /-service\/ui-tests\/.*\.spec\.ts$/,
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
