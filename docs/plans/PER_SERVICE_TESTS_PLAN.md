# Per-service UI and API testing plan

Status: PLAN, nothing implemented. Written 2026-11-24 from a read-only survey (no builds, no test runs).

## 1. Why this exists

The live storefront went blank because a full-screen overlay (PR #636's fly-to-cart layer) was painted opaque by a global CSS rule. Every check passed:

| Check | Why it missed it |
|---|---|
| Component and RTL tests (`vitest`, happy-dom) | No global CSS, no SSR/hydration, no painting. |
| Playwright `storefront-service/ui-tests/home` | Asserts status < 400, `body` visible, a title. `toBeVisible` ignores occlusion. |
| Release smoke (`deploy/k8s/bootstrap/smoke.sh`) | Checks pod health and the commit SHA only. |

Goal: every service and app gets its own UI and API tests, run in its own CI job, and a "can a person see the page" check runs in CI and again after deploy.

## 2. Current state (measured)

### 2.1 Test tiers per service

Counts are test files (`*.test.ts(x)` / `*.spec.ts`), not cases.

| Service / package | Unit (`tests/`) | Component UI (RTL, `integration-tests/ui`) | Browser UI (Playwright) | API route tests (`tests/api`) | DB-backed API (`integration-tests/api-db`) |
|---|---|---|---|---|---|
| packages/store-core (shared UI + handlers) | 570 | 131 | 0 | 5 | 0 |
| controller-service | 81 | 40 | 0 | 31 | 9 |
| storefront-service | 129 | 0 | 3 specs (4 tests) | 121 | 20 |
| admin-service | 332 | 1 | 0 | 316 | 25 |
| business-service | 0 | 0 | 0 | 0 | 0 |
| showcase-service | 4 | 0 | 0 | 2 | 0 |
| messaging-service (Fastify) | 26 | n/a | n/a | 2 files use `inject` | 0 |
| document-service (Fastify) | 73 | n/a | n/a | 1 file uses `inject` | 0 |
| public-api-service (Fastify) | 6 | n/a | n/a | 3 files use `inject` | 0 |
| mobile-service (Fastify, 1 src file) | 0 (`--passWithNoTests`) | n/a | n/a | 0 | 0 |
| mobile-service/client (Expo, ~204 tsx) | 0, no runner | 0 | 0 | n/a | n/a |
| ai-platform gateway (TS) | 7 | n/a | n/a | included | 0 |
| ai-platform PaddleOCR (Python) | 0 | n/a | n/a | 0 | 0 |
| 12 logic packages, cli, site-blocks | tested, each gated at 80 | n/a | n/a | n/a | n/a |

Also: a responsive sweep (`playwright.config.ts`, advisory, storefront + business only, 501 s on the last green run).

### 2.2 Components

Heuristic: a component counts as tested when some test file under `tests/` or `integration-tests/` imports it by path (can overcount slightly because of path-tail matching).

| Owner | Components (`src/components/**` + `*Client.tsx`) | Referenced by any test | By an RTL test | Untested |
|---|---|---|---|---|
| store-core | 526 | 184 | 156 | 342 |
| controller-service | 78 | 39 | 39 | 39 |
| storefront-service | 9 | 0 | 0 | 9 |
| admin-service | 53 | 1 | 0 | 52 |
| business-service | 3 | 0 | 0 | 3 |
| showcase-service | 0 | 0 | 0 | 0 |
| **Total** | **669** | **224 (33%)** | **195** | **445** |

store-core by area (components / tested): `admin` 263/60, `visitor` 175/71, `ui` 15/12, `chat` 10/10, `business` 8/1, `shared` 8/4, `vault` 7/7, `site-editor` 7/3, `on-device` 6/2, `portal` 5/0, `media` 4/0, rest small. The customer-facing `visitor` area has 104 untested components.

### 2.3 API routes

Heuristic: a route counts as covered when a test imports its `route.ts` path.

| App | Route files | Imported by any test | Imported by an api-db test | Untested |
|---|---|---|---|---|
| controller-service | 162 | 53 | 29 | 109 |
| storefront-service | 204 | 148 | 72 | 56 |
| admin-service | 695 | 362 | 69 | 333 |
| business-service | 2 (health, ready) | 0 | 0 | 2 |
| showcase-service | 4 | 2 | 0 | 2 |
| **Total** | **1,067** | **565 (53%)** | **170** | **502** |

Fastify services have roughly 15 (messaging), 6 (document), 20 (public-api), 3 (mobile) literal routes; they have unit tests but no route inventory or per-route check. `scripts/check-api-test-mirror.mjs` only checks that route tests point at a real route, not that every route has one.

### 2.4 Component ownership (import-graph, same walk as `site-editor-imports.test.ts`)

Static plus `import()` reachability from each app's `src`, over the 530 store-core components:

| Reached by | Components |
|---|---|
| all 5 apps (shell, kit, ui) | 143 |
| admin + controller | 83 |
| admin only | 181 |
| storefront only | 36 |
| business + storefront | 31 |
| four apps | 19 |
| admin + business + storefront | 13 |
| controller + storefront | 6 |
| business only | 6 |
| no app (dead code) | 11 |

So 223 components have a single owner, 296 are shared, 11 look orphaned (candidates to delete, not to test).

### 2.5 CI today (`.github/workflows/ci.yml`, run 45339474642, a green PR run)

- 70 jobs, 5,964 job-seconds (about 99 raw minutes, about 135 billed after per-job rounding), about 10 minutes wall clock.
- Already per-service matrices: Lint (13), Type check (13), Unit tests (21 incl. packages), Build (10). Coverage is merged from the parts in one job (165 s, hit an OOM before).
- NOT per service: **Integration (RTL) tests** = one job running all apps (135 s); **API tests (real DB)** = one job, one Postgres (109 s); **UI tests (real browser)** = one job that rebuilds only the storefront (216 s) and runs 3 specs; Responsive sweep (501 s, advisory, not in the gate).
- No path filters: every PR runs everything. The gate (`Checks passed`) lists jobs by name.
- Slowest: Build admin 451 s, Unit admin 217 s, UI tests 216 s, Unit store-core 202 s.
- Coverage gates (`vitest.config.ts`): one glob for all five Next apps (lines 28, branches 21, functions 12), store-core 46/36/36, global floor 36/27/23; 12 packages at 80.
- Release: per-service `Release · <svc>` job runs `smoke.sh` (health + SHA + status code, no rendering).
- Runner cost: the repo is public, so standard and arm runners are free to the owner (verify in the account's billing page). Minute figures below are for scale; a private-repo equivalent is about $0.008 per x64 minute.

## 3. Target layout per service

Principle: three questions per service, each answered by a test in that service's own folder, each run by that service's own job.

| Question | Tool | Where it lives |
|---|---|---|
| Does each component behave? | RTL / happy-dom | store-core components: `packages/store-core/integration-tests/ui/<area>/`. App-owned components: `<app>-service/integration-tests/ui/` (existing glob, no move). |
| Does a person see a working page in a real browser? | Playwright on the app's own production build | `<app>-service/ui-tests/<area>/*.spec.ts` plus shared helper `tests/ui-kit/visible.ts` |
| Does each route/endpoint answer correctly? | vitest, handler called directly | `<app>-service/tests/api/` (mocked) and `<app>-service/integration-tests/api-db/` (real `jeffi_test`) |
| Does the live deploy render? | Playwright against the live URL | `tests/post-deploy/<service>.spec.ts` |

### 3.1 The "visible to a person" check (`tests/ui-kit/visible.ts`)

`expectPageVisible(page)` runs after load and after interactions that mount overlays (add to cart, open cart, open and close dialogs, route change). It fails if any of these hold:

1. **Hit test.** `document.elementsFromPoint` at 9 viewport points (corners inset 8 px, edge midpoints, centre): the top element must be inside the app root (`body > :not(script)` main content, or an allow-listed `[data-ui-overlay]` such as the cookie banner and the open cart drawer).
2. **No opaque full-screen layer.** Walk each hit element's ancestors: a `position: fixed|absolute` box covering at least 90 percent of the viewport with computed `opacity > 0.9` and an opaque background, outside the app root, fails. Also fail if `pointer-events: none` is missing on a decorative overlay that sits on top (it would swallow clicks).
3. **Not blank.** Screenshot, downsample, and require luminance variance above a threshold (a blank white/black page has near zero). Catches the PR #636 case with no baseline image.
4. **Hydrated.** No `Hydration failed` / uncaught error in the console, and the first interactive control receives focus when tabbed.
5. Optional later: `toHaveScreenshot` on one route per app with a loose `maxDiffPixelRatio`. Not recommended now (fonts, data and CDN variance create churn); see decisions.

Proof it works: revert `cf436b09a` locally and confirm the new storefront spec fails (not run as part of this plan).

### 3.2 Per service

| Service | Component UI | Browser UI (own prod build) | API | DB API |
|---|---|---|---|---|
| storefront | store-core `visitor/*` (shared with business) and 9 app components; ratchet to 100 percent | Home, product list, product page, cart with fly-to-cart, checkout entry, a site-builder page; each followed by `expectPageVisible` | 56 untested routes, mutating routes first | grow from 20 files; cart, checkout, auth |
| admin | store-core `admin/*` (203 untested) plus 52 app components | Login page, then signed-in dashboard, product list, one editor; session minted from the test JWT secret in global-setup | 333 untested routes, auth and mutation first | grow from 25 files |
| controller | 39 untested of 78 | Login page, signed-in ecom list, store detail | 109 untested | grow from 9 files |
| business | store-core `business/*` (7 untested) plus 3 app components | Public landing, signup, signed-in catalog with a minted business session | the 2 health routes plus anything it re-exports | one smoke file |
| showcase | none app-owned (shared kit only) | One seeded site by `Host: site-<slug>` header (it is host-routed) | 2 untested routes | one smoke file |
| messaging | n/a | n/a | `test/api/*.test.ts` using Fastify `inject`, one file per route group; route inventory check like the mirror script | optional, against `jeffi_test` |
| document | n/a | n/a | same; PDF endpoints assert content-type and `%PDF` header | same |
| public-api | n/a | n/a | same; add OpenAPI contract test (responses match `openapi.ts`) | same |
| mobile (Fastify) | n/a | n/a | 3 routes: add tests, drop `--passWithNoTests` | n/a |
| mobile client (Expo) | defer (jest-expo, later) | defer (Maestro, later) | n/a | n/a |
| ai-gateway | n/a | n/a | existing 7 plus a route inventory | n/a |
| PaddleOCR | n/a | n/a | add `pytest` over `sample.png` and `/healthz` (file already in repo) | n/a |

### 3.3 Config changes (design only)

- `playwright.ui.config.ts`: take `UI_APP=<storefront|admin|controller|business|showcase>`; derive `testDir`, `baseURL` and port (3010 storefront, 3011 admin, 3012 controller, 3013 business, 3014 showcase) from it; `globalSetup` mints the app's test session when needed.
- `vitest.integration.config.ts` and `vitest.db.config.ts`: add one project per app (as `vitest.config.ts` already does) so a job runs `--project admin`. Keep globs and aliases as they are.
- `vitest.config.ts` coverage: replace the single five-app glob with one glob per service (business at 0 until it has tests), ratcheting up only.
- `scripts/component-owners.mjs`: the import-graph walk above, writing `scripts/component-owners.json` (component to owning apps). Used by CI and by a ratchet check.
- `scripts/check-component-tests.mjs` and `scripts/check-route-tests.mjs`: fail when a component or route has no test and is not in a shrink-only allowlist (starts with the 445 and 502 above). This is the enforcement for "all components".

## 4. Shared store-core components: test once or per service?

**Recommendation: test each shared component once, in store-core, with RTL; cover the per-service integration with each app's own browser tests.**

| | Once in store-core | Per consuming service |
|---|---|---|
| Runs | 1 time | up to 5 times (143 components are in every app) |
| Maintenance | one test file per component | up to 5 copies drifting apart |
| Catches component logic bugs | yes | yes, redundantly |
| Catches "this app's CSS/layout/provider breaks it" (the PR #636 class) | no | no (still happy-dom) |
| That class is caught by | the per-app browser tests on the real build | same |
| Ownership signal | the manifest says which apps render it | implicit |

Rules:
- RTL tests live with the code (store-core for store-core components, the app for app components). No duplication across apps.
- A store-core change fans out to browser jobs only for the apps that reach the changed file (from `component-owners.json`), so shared coverage does not mean every job always runs.
- Components reached by no app (11) are deleted or listed as dead, not tested.

## 5. CI design

### 5.1 Shape

```
changes ─┬─> Lint / Type check (matrix, affected apps)          ┐
         ├─> Unit · <svc>       (matrix, affected, shard big)   │
         ├─> Components · <app> (RTL, vitest --project)         ├─> Checks passed (the one required status)
         ├─> API · <app>        (api-db, own Postgres)          │
         ├─> Build + browser · <app>  (Next apps: build once,   │
         │      Playwright against `next start`)                │
         └─> Service API · <fastify svc> (inject + inventory)   ┘
```

- **`changes` job** (extends `init`): `node scripts/affected.mjs <base> <head>` prints a JSON matrix. Rules: files under `<app>-service/` mark that app; `packages/store-core/**` marks only the apps that reach the changed files (owners manifest); other `packages/*` mark their dependents (from `package.json` deps); root configs (`vitest*`, `playwright*`, `ci.yml`, `package-lock.json`, `scripts/db-files.mjs`, `tsconfig*`) mark everything; any `database/` file marks the API jobs of the owning service plus all that load the schema. **Pushes to main and `workflow_dispatch` always run everything.** A nightly `schedule` also runs everything (with the responsive sweep).
- **Per-service job set**: each Next app gets Lint, Type, Unit, Components, API (real DB) and Build + browser as separate matrix cards, so a red card names the service and the kind. Fastify services keep Lint, Type, Unit, Build (image) and gain Service API.
- **Build + browser** replaces both `Build · <next app>` and `UI tests (real browser)`: after `next build` the job starts `next start` against a Postgres service container seeded by `scripts/seed-test-db.sql` and runs `UI_APP=<app> npm run test:ui`. This removes the separate storefront rebuild (216 s) instead of repeating it for five apps.
- **Gate**: `Checks passed` uses `needs: [all]` with `if: always()` and passes when no needed job is `failure` or `cancelled` (a `skipped` job for an unaffected app is fine). The job name stays `Checks passed` so branch protection and the release approval are untouched.

### 5.2 Cost and time (estimates from the measured run)

Baseline: 99 raw job-minutes, about 10 minutes wall clock, full run on every PR.

| Change | Raw job-minutes |
|---|---|
| Browser tier for admin, controller, business, showcase (Playwright install about 40 s, start, 3 to 5 min of specs each) | +16 to +20 |
| Storefront UI job merged into its build job | -3.6 |
| RTL split into 5 app jobs (extra checkout and cached `npm ci` about 45 s each, same test time) | +4 |
| api-db split into 4 jobs (own Postgres and schema load about 40 s each) | +3 |
| Fastify service API jobs (5 small) | +3 |
| **Full run (main, nightly, root-config change)** | **about 125 to 130 (+28 percent)** |
| Typical PR touching one app (affected only) | about 55 to 75 (below today) |
| Docs/test-only PR | under 25 |

Wall clock stays near 10 to 12 minutes (jobs run in parallel; the longest is admin build plus browser, about 11 minutes, which sharding the admin browser specs in 2 brings back to about 8).

Savings levers:
- Affected-only matrix (above): the main saver.
- `actions/cache` for `.next/cache` keyed on lockfile plus source hash: 30 to 50 percent off repeat builds.
- Playwright browser cache (`~/.cache/ms-playwright` keyed on the Playwright version).
- Shard only the long ones: admin and store-core unit (`vitest --shard`), admin browser specs (`playwright --shard`). Do not shard the rest; the fixed cost per shard (about 60 s) outweighs the gain.
- Keep `cancel-in-progress` for PRs (already on).
- Drop the merged Coverage job once per-service gates run in each part job (saves 165 s and the OOM risk); keep it until component coverage lands.
- Concurrency: about 85 jobs for a full run is within the 20-concurrent default only because most are short; watch queue time, and let the nightly run be the full one.

### 5.3 Secrets and safety

Tests use only the throwaway values already in `ci.yml` (`test-jwt-secret...`, `jeffi_test` Postgres on localhost). Nothing new needs a secret. Post-deploy smoke uses no credentials (anonymous pages and login pages only).

## 6. Post-deploy browser smoke per service

New step inside each `Release · <service>` job, after the existing `smoke.sh`: `LIVE_URL=<public host> npx playwright test tests/post-deploy/<service>.spec.ts`.

| Service | Live URL | Checks |
|---|---|---|
| storefront | `https://jeffistores.in/` and one tenant store host (the probe store) | status < 400, `/api/health` commit equals the release SHA, `expectPageVisible`, product grid present, no console errors |
| admin | admin host login page | visible check, login form usable, no hydration error |
| controller | `https://ecom.jeffistores.in/` login page | same |
| business | `https://business.jeffistores.in/` | same |
| showcase | one seeded `site-<slug>` host | same |
| messaging, documents, public-api, mobile, ai-gateway | health URL | existing health check plus one contract assertion (public-api `/openapi.json` parses; ai-gateway `/v1/providers`) |

Rules: read-only, no logins, no writes, no PII, no revenue data on screen or in traces. On failure the Release job fails and the Post summary says which service and which check; rollback stays manual (`rollout.sh` with the previous tag). First week: `continue-on-error` so false alarms are found before it blocks a release. Chromium install is cached; about 90 s per service, about 8 minutes extra per release (releases only run on merges to main).

## 7. Phased rollout

Each phase is a separate PR and lands alone.

| Phase | Scope | Effort | Risk | Done when |
|---|---|---|---|---|
| 0. Visible-page check | `tests/ui-kit/visible.ts`; use it in the 3 storefront specs; add an add-to-cart spec that asserts visibility after the fly-to-cart animation | 0.5 to 1 day | Low (test-only) | Reverting `cf436b09a` locally fails the storefront browser job; green on current main |
| 1. Per-service CI matrix for existing tests | `scripts/affected.mjs`; vitest `--project` per app for integration and db configs; split Integration and API tests by app; gate rewritten to skip-tolerant; no new tests | 1.5 to 2 days | Medium (gate semantics, required-check name, affected rules being too narrow) | A business-only PR runs only business and shared jobs; main still runs everything; wrong-narrow guard: nightly full run is green for a week |
| 2. Browser tier for every Next app | Parameterised Playwright config, per-app ports, session-minting global-setup, one smoke spec per app (landing/login plus visible check), moved into the build job, storefront rebuild job removed | 3 to 4 days | Medium (session minting, Postgres per job, admin memory and build time of 451 s, flakiness) | Five apps each have a green browser job in the gate; storefront UI job gone; retry budget under 2 percent flakes over 20 runs |
| 3. Post-deploy smoke | `tests/post-deploy/*.spec.ts`, Release job step, advisory for a week, then enforced | 1 to 2 days | Medium (live-data variance, false alarms) | A release job fails on a deliberately blank page in a dry run; clean on 5 consecutive real releases |
| 4. Fastify and non-Next API tests | `inject` tests per route for messaging, documents, public-api, mobile; OpenAPI contract test; route inventory check; PaddleOCR pytest; drop `--passWithNoTests` | 4 to 5 days | Low | Every Fastify route has a test; inventory check in CI |
| 5a. Components: storefront visitor | About 104 untested `visitor` components plus 9 app components, behind a shrink-only allowlist and `check-component-tests` | about 6 to 8 agent-days | Low (tests only) | Allowlist for `visitor` and storefront is empty |
| 5b. Components: controller and shared admin/controller | 39 controller plus the shared kit components | about 5 to 6 agent-days | Low | Controller allowlist empty |
| 5c. Components: admin | about 203 store-core `admin/*` plus 52 app components | about 14 to 18 agent-days | Low | Admin allowlist empty |
| 5d. Components: business, showcase, misc store-core | about 40 components (business, portal, media, on-device, site-editor, shared) | about 3 to 4 agent-days | Low | Global allowlist empty; dead components deleted |
| 6. API route coverage ratchet | 502 untested routes; mutating and auth routes first; `check-route-tests` allowlist shrinks; per-service coverage gates replace the single glob and ratchet | open ended, about 20 agent-days, parallelisable by route group | Low | Allowlist at zero or only read-only health-type routes; per-service gates at or above 60 |
| 7. Optional | Screenshot baselines on one route per app; Expo client tests (jest-expo, Maestro) | later | Medium | Only if phases 0 to 3 miss a regression class |

Phases 0 to 3 stop the PR #636 class of outage (about 7 to 9 days of work); 4 to 6 are coverage growth and can run in parallel after phase 1 using one agent per file boundary.

## 8. Decisions for you

| # | Decision | Recommendation |
|---|---|---|
| 1 | Shared components: test once in store-core, or per consuming service? | Once in store-core; each app's browser tests cover the integration (section 4). |
| 2 | Browser tests inside the build job, or a separate job with the build uploaded as an artifact? | Inside the build job: no artifact transfer, no second build, one card per app. |
| 3 | Path filtering by directory only, or by the import-graph owners manifest? | Import-graph manifest; directory-only would treat every store-core edit as "everything" and lose most of the savings. Always full on main and nightly. |
| 4 | Gate stays one `Checks passed` status? | Yes, keep the name; skipped jobs for unaffected apps count as passing. |
| 5 | Post-deploy smoke failure policy | Advisory for one week, then fail the Release job and report; manual rollback, no auto-rollback. |
| 6 | Visual regression screenshots | Not now. Hit-test, opaque-layer and blank-page checks cover the outage class without baseline churn; revisit in phase 7. |
| 7 | Auth for admin, controller, business browser tests | Mint test sessions in global-setup from the test JWT secret, not by driving the login UI (no OTP/TOTP in CI). Login pages are covered by their own anonymous specs. |
| 8 | "All components tested": enforcement | Shrink-only allowlist plus `check-component-tests`, with line coverage gates ratcheting alongside; do not set a global 80 until phase 5 is done. |
| 9 | Expo client and PaddleOCR | PaddleOCR pytest in phase 4 (cheap); Expo client tests deferred. |
| 10 | Merged Coverage job | Keep until phase 5 completes, then move gates into the per-service part jobs and delete the merge. |
| 11 | The 11 orphaned store-core components | Delete them (separate PR) rather than test them. |
| 12 | Nightly full run plus responsive sweep on `schedule` | Yes; cheap on a public repo and the safety net for the affected-only matrix. |

## Appendix: how the numbers were taken

File counts by `find` over each service's `tests/`, `integration-tests/{ui,api-db}/` and `ui-tests/`. Component and route coverage by matching import specifiers in test files against each component or `route.ts` path (heuristic; treat as plus or minus 5 percent). Ownership by the same static-plus-dynamic import walk as `packages/store-core/tests/lib/site-editor-imports.test.ts`, extended to all five Next apps. CI timings from the job durations of run 45339474642.
