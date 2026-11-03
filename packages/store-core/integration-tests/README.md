# integration-tests

Integration and UI tests, run **separately** from the unit suite.

- Run: `npm run test:integration`
- Config: `vitest.integration.config.ts` (root). Env + path aliases mirror the unit
  `vitest.config.ts`; shared setup is `packages/store-core/integration-tests/setup.ts`.
- Each project keeps its own under `<project>/integration-tests/` (this package, and
  `admin-service` and `controller-service`; any app may add one).
- The default `npm test` does **not** run these (it globs `<project>/tests/**`); CI runs
  this suite in its own step.

## What belongs here

- **UI render tests** (`.tsx`): render components with `@testing-library/react` in the
  happy-dom environment and assert on the rendered output. Use for new components and
  for guarding shipped UI fixes.
- **Cross-module integration tests**: flows that span several modules and are heavier
  than a focused unit test.

Layout/CSS fixes that live in a non-renderable server component (e.g. an inline async
component that queries the DB) are guarded with a source-level assertion instead — see
`admin-service/integration-tests/ui/business-rfqs-stats.test.tsx` for the pattern.

## Layout

```
packages/store-core/integration-tests/
  setup.ts            # mock reset + RTL cleanup + jest-dom matchers (shared by every project)
  ui/                 # UI render tests of shared components
<app>-service/integration-tests/
  ui/                 # page layout guards, e.g. admin-service/integration-tests/ui/business-rfqs-stats
```

## Playwright (follow-up, not yet set up)

True browser end-to-end tests (real rendering, clicks, navigation) are a planned
follow-up. They need: the `@playwright/test` dep, a browser install step in CI, and a
separate `test:e2e` script + `playwright.config.ts`. Keep those under a future
`<project>/integration-tests/e2e/` so the RTL (`ui/`) suite stays dependency-light.
