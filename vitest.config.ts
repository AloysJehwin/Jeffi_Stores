import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    pool: 'forks',
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
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary', 'json'],
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        branches: 77,
        statements: 80,
        functions: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
