import { defineConfig } from 'vitest/config'
import path from 'path'

// CI runs each project in its own job (VITEST_PART) and checks the thresholds once, over the merged parts.
const part = !!process.env.VITEST_PART

// Per-service / per-package coverage gates (the 80% effort — see ~/.claude plan delegated-gathering-wand).
// Vitest coverage is global (one run), so per-service gates are glob-keyed thresholds: each glob is an
// independent floor over that service's src. Seeded a point or two below the measured baseline so one new
// gated branch can't tip CI red; RATCHET each toward 80 as tests land — these only ever go UP.
// Untested packages/standalone services start at 0 and climb. `perFile: false` (default): the glob is the aggregate.
const SERVICE_GATES: Record<string, { lines: number; branches: number; statements: number; functions: number }> = {
  '{controller,storefront,admin,business,showcase}-service/src/**': { lines: 28, branches: 21, statements: 27, functions: 12 },
  'packages/store-core/src/**': { lines: 44, branches: 34, statements: 42, functions: 33 },
}

// Root projects: apps + every package gets its own, so `npx vitest --project <name> --coverage` is a real per-unit gate.
const APP_PROJECTS: [string, string][] = [
  ['store-core', 'packages/store-core'],
  ['storefront', 'storefront-service'],
  ['admin', 'admin-service'],
  ['business', 'business-service'],
  ['controller', 'controller-service'],
  ['showcase', 'showcase-service'],
]
// Pure-logic packages (node env, their own 80% gate). Seeded at the measured floor (a point under) and
// ratcheted toward 80 as tests land — these only ever go UP. mail-shell/list-filters/site-blocks already
// get high incidental coverage from store-core tests; the near-zero ones climb with their own suites.
const LOGIC_PACKAGES = [
  'service-auth', 'tenancy', 'wallet', 'pricing', 'gst', 'bulk',
  'draft-locks', 'list-filters', 'push', 'mail-shell', 'site-blocks', 'api-contracts', 'design-tokens',
]
// Measured 2026-11-22 (floored): per-package {lines,branches,statements,functions}. design-tokens has no
// executable lines yet → stays 0. Any package not listed defaults to 0.
const PACKAGE_FLOORS: Record<string, [number, number, number, number]> = {
  'service-auth': [56, 42, 45, 43],
  tenancy: [16, 9, 15, 5],
  wallet: [3, 0, 3, 0],
  pricing: [57, 27, 52, 33],
  gst: [0, 0, 0, 0],
  bulk: [0, 0, 0, 0],
  'draft-locks': [23, 11, 21, 19],
  'list-filters': [85, 74, 83, 74],
  push: [18, 6, 16, 11],
  'mail-shell': [95, 85, 92, 88],
  'site-blocks': [68, 53, 64, 56],
  'api-contracts': [40, 8, 32, 17],
  'design-tokens': [0, 0, 0, 0],
}

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
      DELHIVERY_API_KEY: 'test-delhivery-key',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      SERVICE_AUTH_SECRET: 'test-service-auth-secret',
    },
    // One project per app or package, each running its own tests/. `npx vitest --project admin` runs one.
    projects: [
      ...APP_PROJECTS.map(([name, dir]) => ({ extends: true as const, test: { name, include: [`${dir}/tests/**/*.test.{ts,tsx}`] } })),
      { extends: true as const, test: { name: 'cli', include: ['packages/cli/tests/**/*.test.ts'], environment: 'node' } },
      ...LOGIC_PACKAGES.map((pkg) => ({
        extends: true as const,
        test: { name: pkg, include: [`packages/${pkg}/tests/**/*.test.{ts,tsx}`], environment: 'node' as const },
      })),
    ],
    coverage: {
      provider: 'v8',
      reporter: part ? ['json-summary'] : ['text', 'lcov', 'json-summary', 'json'],
      include: [
        '{controller,storefront,admin,business,showcase}-service/src/**/*.{ts,tsx}',
        'packages/store-core/src/**/*.{ts,tsx}',
        ...LOGIC_PACKAGES.map((pkg) => `packages/${pkg}/src/**/*.{ts,tsx}`),
      ],
      // Per-service glob gates live in SERVICE_GATES (above). Package gates are generated below, seeded at 0 and
      // ratcheted toward 80 as their tests land. The bare lines/branches/... keys are the global floor over any
      // file not matched by a glob. All checked only on the merged run (!part); part-jobs skip thresholds.
      thresholds: part
        ? undefined
        : {
            ...SERVICE_GATES,
            ...Object.fromEntries(
              LOGIC_PACKAGES.map((pkg) => {
                const [lines, branches, statements, functions] = PACKAGE_FLOORS[pkg] ?? [0, 0, 0, 0]
                return [`packages/${pkg}/src/**`, { lines, branches, statements, functions }]
              }),
            ),
            lines: 36,
            branches: 27,
            statements: 34,
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
      '@showcase': path.resolve(__dirname, './showcase-service/src'),
      '@': path.resolve(__dirname, './packages/store-core/src'),
      'server-only': path.resolve(__dirname, './node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
})
