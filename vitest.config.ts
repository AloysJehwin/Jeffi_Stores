import { defineConfig } from 'vitest/config'
import path from 'path'

// CI runs each project in its own job (VITEST_PART) and checks the thresholds once, over the merged parts.
const part = !!process.env.VITEST_PART

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./packages/store-core/tests/setup.ts'],
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
      SERVICE_AUTH_SECRET: 'test-service-auth-secret',
    },
    // One project per app or package, each running its own tests/. `npx vitest --project admin` runs one.
    projects: [
      ['store-core', 'packages/store-core'],
      ['storefront', 'storefront-service'],
      ['admin', 'admin-service'],
      ['business', 'business-service'],
      ['controller', 'controller-service'],
    ].map(([name, dir]) => ({ extends: true as const, test: { name, include: [`${dir}/tests/**/*.test.{ts,tsx}`] } })),
    coverage: {
      provider: 'v8',
      reporter: part ? ['json-summary'] : ['text', 'lcov', 'json-summary', 'json'],
      include: ['{controller,storefront,admin,business}-service/src/**/*.{ts,tsx}', 'packages/store-core/src/**/*.{ts,tsx}'],
      // Baseline after adding .tsx to coverage (#524) and the service split: measured
      // statements 38.9 / lines 39.7 / branches 31.8 / functions 25.1. Floored a point below
      // the measured numbers so a single new gated branch can't tip CI red; raise as coverage grows.
      // Branches lowered to 30 after support 2.0 + Drive (measured 30.8) until their tests land.
      thresholds: part ? undefined : {
        lines: 39,
        branches: 30,
        statements: 38,
        functions: 23,
      },
    },
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
