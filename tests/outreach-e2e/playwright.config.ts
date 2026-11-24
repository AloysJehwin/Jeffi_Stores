// The Outreach flow end to end (docs/OUTREACH_E2E.md, part B): CSV import -> test-mode program -> a call placed through
// voice-service and answered by tests/voice-e2e's simulated owner -> tools build the site -> preview link captured ->
// preview page -> publish -> claim on ecom with email OTP -> the site is in the owner's workspace on a trial.
// Needs the controller running locally on jeffi_test (DATABASE_URL), Redis, and python3 for the voice simulator.
//   npx playwright test -c tests/outreach-e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: /tests\/outreach-e2e\/.*\.spec\.ts$/,
  globalSetup: './global-setup.ts',
  outputDir: '../ui-output/outreach-e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
