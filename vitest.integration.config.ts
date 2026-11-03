import { defineConfig } from 'vitest/config'
import path from 'path'

// Integration / UI test runner — SEPARATE from the unit suite (vitest.config.ts).
// Run with `npm run test:integration`. Each project keeps these in its own integration-tests/,
// which the unit config doesn't glob, so `npm test` skips them; CI runs this config in its own step.
// RTL (.tsx) tests now; a Playwright E2E runner is a documented follow-up (see
// packages/store-core/integration-tests/README.md), not wired here.
// Alias + env literals mirror vitest.config.ts intentionally — keep them in sync.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./packages/store-core/integration-tests/setup.ts'],
    pool: 'forks',
    // @ts-expect-error poolOptions not yet in vitest v4 InlineConfig types
    poolOptions: {
      forks: {
        maxForks: 8,
      },
    },
    env: {
      JWT_SECRET: 'test-jwt-secret-at-least-32-bytes!!',
      CRON_SECRET: 'test-cron-secret',
      RAZORPAY_WEBHOOK_SECRET: 'test-webhook-secret',
      RAZORPAYX_WEBHOOK_SECRET: 'test-razorpayx-secret',
      DELHIVERY_API_KEY: 'test-delhivery-key',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
    },
    include: ['{packages/store-core,storefront-service,admin-service,business-service,controller-service}/integration-tests/**/*.test.{ts,tsx}'],
    // No coverage block: coverage stays on the unit run so the #524 baseline is untouched.
  },
  resolve: {
    alias: {
      '@controller': path.resolve(__dirname, './controller-service/src'),
      '@storefront': path.resolve(__dirname, './storefront-service/src'),
      '@admin': path.resolve(__dirname, './admin-service/src'),
      '@business': path.resolve(__dirname, './business-service/src'),
      '@': path.resolve(__dirname, './packages/store-core/src'),
      'server-only': path.resolve(__dirname, './node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
})
