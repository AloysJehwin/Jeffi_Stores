import { defineConfig } from 'vitest/config'
import path from 'path'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
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
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary', 'json'],
      include: ['controller-service/src/**/*.ts', 'controller-service/src/**/*.tsx'],
      // Baseline after adding .tsx to coverage (#524) and the service split: measured
      // statements 38.9 / lines 39.7 / branches 31.8 / functions 25.1. Floored a point below
      // the measured numbers so a single new gated branch can't tip CI red; raise as coverage grows.
      thresholds: {
        lines: 39,
        branches: 31,
        statements: 38,
        functions: 23,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './controller-service/src'),
      'server-only': path.resolve(__dirname, './node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
})
