import { defineConfig } from 'vitest/config'

// Own 80% gate (the coverage effort). Measured 2026-11-22; floored; ratchet toward 80 — only goes UP.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { lines: 36, branches: 40, statements: 37, functions: 24 },
    },
  },
})
