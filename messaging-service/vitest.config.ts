import { defineConfig } from 'vitest/config'

// Own 80% gate (the coverage effort). 2026-11-22 measured 88.7/76.2/83.3/92.5 — lines/statements/functions LOCKED
// at 80; branches floored at 76 (still climbing to 80, needs ~55 more branch hits in send.ts/templates.ts/wa-approval.ts).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { lines: 80, branches: 76, statements: 80, functions: 80 },
    },
  },
})
