import { defineConfig } from 'vitest/config'
import path from 'path'

// DB-backed API test runner (the jeffi_test tier) — SEPARATE from unit (vitest.config.ts) and the RTL
// integration suite (vitest.integration.config.ts). Run with `npm run test:db` (sets API_DB=1).
// Globs ONLY <app>/integration-tests/api-db/**. Runs SINGLE-THREADED: every test shares the one jeffi_test
// Postgres, so parallel files would stomp each other's rows — fileParallelism:false + singleFork serialize them.
// Node environment (real `pg`); files also carry `// @vitest-environment node`. Aliases/env mirror the others.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    pool: 'forks',
    // @ts-expect-error poolOptions not yet in vitest v4 InlineConfig types
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    env: {
      JWT_SECRET: 'test-jwt-secret-at-least-32-bytes!!',
      CRON_SECRET: 'test-cron-secret',
      SERVICE_AUTH_SECRET: 'test-service-auth-secret',
      RAZORPAY_WEBHOOK_SECRET: 'test-webhook-secret',
      DELHIVERY_API_KEY: 'test-delhivery-key',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
    },
    include: ['{packages/store-core,storefront-service,admin-service,business-service,controller-service}/integration-tests/api-db/**/*.test.{ts,tsx}'],
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
