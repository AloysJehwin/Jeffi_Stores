// Site Builder responsive sweep (docs/SITE_BUILDER_PLAN.md §5): `npm run sweep:responsive` against a running server
// at http://localhost:3000 (SWEEP_BASE_URL overrides): the dev router plus the storefront app, and the business app for
// the B2B pack (a pack whose app is down is listed as skipped). Needs DATABASE_URL and JWT_SECRET (tests/responsive/
// env.ts reads .env.local) to make the throwaway drafts and sign their preview tokens; teardown deletes the drafts.
// Chromium only. Output: tests/responsive/output/ (summary.md, summary.json, findings.jsonl, screenshots/, report/).
// Options: SWEEP_PACKS=tech-mono,b2b-pro  SWEEP_WIDTHS=360,1280  SWEEP_WORKERS=2  SWEEP_BUSINESS_COOKIE=<business_sid>
// (the business portal's About and Support pages need a signed-in business account).
import { defineConfig, devices } from '@playwright/test'

const OUT = 'tests/responsive/output'

export default defineConfig({
  testDir: 'tests/responsive',
  testMatch: /sweep\.spec\.ts$/,
  globalSetup: './tests/responsive/global-setup.ts',
  globalTeardown: './tests/responsive/summary.ts',
  outputDir: `${OUT}/test-results`,
  fullyParallel: true,
  // One browser at a time locally: the dev server compiling each page is the memory hog.
  workers: Number(process.env.SWEEP_WORKERS) || (process.env.CI ? 2 : 1),
  retries: 0,
  timeout: process.env.CI ? 180_000 : 300_000, // a dev server compiles each page on first load
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: `${OUT}/report`, open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    navigationTimeout: process.env.CI ? 90_000 : 150_000,
    actionTimeout: 15_000,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
