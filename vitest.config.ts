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
// design-tokens is handled separately (prebuilt index.js, no src/) — see DESIGN_TOKENS_* below.
const LOGIC_PACKAGES = [
  'service-auth', 'tenancy', 'wallet', 'pricing', 'gst', 'bulk',
  'draft-locks', 'list-filters', 'push', 'mail-shell', 'site-blocks', 'api-contracts',
]
// design-tokens ships compiled (index.js, no TypeScript src/). Its gate targets the built file.
const DESIGN_TOKENS_GLOB = 'packages/design-tokens/index.js'
const DESIGN_TOKENS_FLOOR = { lines: 0, branches: 0, statements: 0, functions: 0 }
// Per-package {lines,branches,statements,functions}. Gate = 80 (target, LOCKED) once a package's suite lands
// and clears it; the rest stay at their measured 2026-11-22 floor and ratchet up. Only ever goes UP.
const PACKAGE_FLOORS: Record<string, [number, number, number, number]> = {
  'service-auth': [80, 80, 80, 80],
  tenancy: [80, 80, 80, 80],
  wallet: [80, 80, 80, 80],
  pricing: [80, 80, 80, 80],
  gst: [80, 80, 80, 80],
  bulk: [80, 80, 80, 80],
  'draft-locks': [80, 80, 80, 80],
  'list-filters': [80, 80, 80, 80],
  push: [80, 80, 80, 80],
  'mail-shell': [80, 80, 80, 80],
  'site-blocks': [80, 80, 80, 80],
  'api-contracts': [80, 80, 80, 80],
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
      { extends: true as const, test: { name: 'design-tokens', include: ['packages/design-tokens/tests/**/*.test.{ts,tsx}'], environment: 'node' } },
    ],
    coverage: {
      provider: 'v8',
      reporter: part ? ['json-summary'] : ['text', 'lcov', 'json-summary', 'json'],
      include: [
        '{controller,storefront,admin,business,showcase}-service/src/**/*.{ts,tsx}',
        'packages/store-core/src/**/*.{ts,tsx}',
        ...LOGIC_PACKAGES.map((pkg) => `packages/${pkg}/src/**/*.{ts,tsx}`),
        DESIGN_TOKENS_GLOB,
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
            [DESIGN_TOKENS_GLOB]: DESIGN_TOKENS_FLOOR,
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
