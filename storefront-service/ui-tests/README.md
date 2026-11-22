# ui-tests — browser UI tests, per app, per component

Real Chromium (Playwright) against a running app backed by the seeded `jeffi_test` DB.
Layout: `<app>-service/ui-tests/<component>/*.spec.ts` (e.g. `storefront-service/ui-tests/home/home.spec.ts`).
Separate from the responsive sweep (`tests/responsive/`).

## Run locally

1. `bash scripts/setup-test-db.sh` (idempotent; never touches `jeffi_production_ready`).
2. Build + start the app under test (storefront on :3010), pointed at jeffi_test:
   ```
   DATABASE_URL=postgresql://$USER@localhost:5432/jeffi_test npm run build:storefront
   DATABASE_URL=postgresql://$USER@localhost:5432/jeffi_test JWT_SECRET=test-jwt-secret-at-least-32-bytes!! \
     SERVICE_AUTH_SECRET=test-service-auth-secret SKIP_DB_CHECK=true npx next start storefront-service -p 3010
   ```
3. Run all UI tests, or just one component:
   ```
   npm run test:ui
   npx playwright test --config playwright.ui.config.ts storefront-service/ui-tests/home
   ```
   Override the target with `UI_BASE_URL`.

## CI

`ui-tests` job: ephemeral `jeffi_test` Postgres (schema + seed), Chromium install, build +
start storefront on :3010, `npm run test:ui`. Serialized (workers: 1). In the merge-gate `checks`.

## Adding a component

Create `<app>-service/ui-tests/<component>/<component>.spec.ts` and drive the real page
(navigate, click, fill, assert). Seed any extra rows it needs in jeffi_test first.
