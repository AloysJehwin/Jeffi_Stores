# integration-tests

Integration and UI tests, run **separately** from the unit suite.

- Run: `npm run test:integration`
- Config: `vitest.integration.config.ts` (root). Env + path aliases mirror the unit
  `vitest.config.ts`; shared setup is `integration-tests/setup.ts`.
- The default `npm test` does **not** run these (its glob is `tests/**`); CI runs this
  suite in its own step.

## What belongs here

- **UI render tests** (`.tsx`): render components with `@testing-library/react` in the
  happy-dom environment and assert on the rendered output. Use for new components and
  for guarding shipped UI fixes.
- **Cross-module integration tests**: flows that span several modules and are heavier
  than a focused unit test.

Layout/CSS fixes that live in a non-renderable server component (e.g. an inline async
component that queries the DB) are guarded with a source-level assertion instead — see
`ui/business-rfqs-stats.test.tsx` for the pattern.

## Layout

```
integration-tests/
  setup.ts            # mock reset + RTL cleanup + jest-dom matchers
  ui/                 # UI render + layout-guard tests
```

## Playwright (follow-up, not yet set up)

True browser end-to-end tests (real rendering, clicks, navigation) are a planned
follow-up. They need: the `@playwright/test` dep, a browser install step in CI, and a
separate `test:e2e` script + `playwright.config.ts`. Keep those under a future
`integration-tests/e2e/` so the RTL (`ui/`) suite stays dependency-light.
