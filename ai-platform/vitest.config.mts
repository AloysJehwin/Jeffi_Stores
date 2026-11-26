import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['gateway/test/**/*.test.ts'],
    environment: 'node',
    // Own 80% gate (the coverage effort). Measured 2026-11-26; floored; ratchet toward 80 — only goes UP.
    coverage: {
      provider: 'v8',
      include: ['gateway/src/**/*.ts'],
      thresholds: { lines: 68, branches: 60, statements: 66, functions: 67 },
    },
  },
})
