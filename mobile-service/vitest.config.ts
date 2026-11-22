import { defineConfig } from 'vitest/config'

// Own 80% gate (the coverage effort). Seeded at 0; ratchet up as tests land — only ever goes UP.
// Scope is the Node server under src/; the Expo client (client/) is built/tested by EAS, not vitest.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { lines: 0, branches: 0, statements: 0, functions: 0 },
    },
  },
})
