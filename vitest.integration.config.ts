import { defineConfig } from 'vitest/config'
import path from 'path'

// Integration / UI test runner — SEPARATE from the unit suite (vitest.config.ts).
// Run with `npm run test:integration`. Each project keeps these in its own integration-tests/,
// which the unit config doesn't glob, so `npm test` skips them; CI runs this config in its own step.
// RTL (.tsx) tests now; a Playwright E2E runner is a documented follow-up (see
// packages/store-core/integration-tests/README.md), not wired here.
// Alias + env literals mirror vitest.config.ts intentionally — keep them in sync.
const APP_PROJECTS: [string, string][] = [
  ['store-core', 'packages/store-core'],
  ['storefront', 'storefront-service'],
  ['admin', 'admin-service'],
  ['business', 'business-service'],
  ['controller', 'controller-service'],
  ['showcase', 'showcase-service'],
]

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
      DELHIVERY_API_KEY: 'test-delhivery-key',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
    },
    // One project per app (and store-core), so CI runs `--project <app>`; with no --project every project runs,
    // the same files the single glob matched.
    projects: APP_PROJECTS.map(([name, dir]) => ({ extends: true as const, test: { name, include: [`${dir}/integration-tests/**/*.test.{ts,tsx}`] } })),
    // No coverage block: coverage stays on the unit run so the #524 baseline is untouched.
  },
  resolve: {
    alias: {
      '@controller': path.resolve(__dirname, './controller-service/src'),
      '@storefront': path.resolve(__dirname, './storefront-service/src'),
      '@admin': path.resolve(__dirname, './admin-service/src'),
      '@business': path.resolve(__dirname, './business-service/src'),
      '@showcase': path.resolve(__dirname, './showcase-service/src'),
      '@': path.resolve(__dirname, './packages/store-core/src'),
      'server-only': path.resolve(__dirname, './node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
})
