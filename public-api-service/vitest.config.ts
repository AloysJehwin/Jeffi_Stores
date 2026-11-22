import { defineConfig } from 'vitest/config'

// Own 80% gate (the coverage effort). Reached 80 on all four 2026-11-22 (measured 95.4/82.7/93.2/91.2); LOCKED at 80.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { lines: 80, branches: 80, statements: 80, functions: 80 },
    },
  },
})
