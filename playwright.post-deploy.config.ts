// Read-only browser smoke against the LIVE deploy (docs/plans/PER_SERVICE_TESTS_PLAN.md section 6): anonymous
// pages and login pages only, no logins, no writes. Run from a Release job after smoke.sh:
//   LIVE_URL=https://jeffistores.in npx playwright test -c playwright.post-deploy.config.ts tests/post-deploy/storefront.spec.ts
// Optional env: RELEASE_SHA (health commit must equal it), STORE_URL (a tenant store host), ADMIN_URL,
// SHOWCASE_URL, MESSAGING_URL, DOCUMENTS_URL, PUBLIC_API_URL, MOBILE_URL, AI_GATEWAY_URL.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/post-deploy',
  testMatch: /\.spec\.ts$/,
  outputDir: 'tests/ui-output/post-deploy',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.LIVE_URL,
    ...devices['Desktop Chrome'],
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    screenshot: 'off', // live pages can show customer data
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
