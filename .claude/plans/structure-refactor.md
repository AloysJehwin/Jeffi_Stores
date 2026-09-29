# Structure and format refactor

Status: plan only. Nothing here starts until PR #507 is merged.

## Goal

Make the repository easy to navigate and hard to break, without changing URLs or behaviour:

- One formatting standard (Prettier + EditorConfig) that matches the style the code already uses, applied once per folder as formatting-only commits.
- Delete dead code, tracked junk and duplicate tests.
- Fix inverted dependencies (`src/lib` importing `src/app` or `src/components`, `src/components` importing `src/app`, UI importing route modules) and lock the direction with lint.
- Colocate page-private components next to the route that owns them, so `src/components` holds only code used by two or more routes.
- Make every non-route folder under `src/app` explicitly private (`_components`, `_lib`, `_demo`, ...).
- Make `tests/` mirror `src/` exactly (literal `[id]` segments, one test file per route).
- Keep ops folders (`database/`, `deploy/`, compose files, `server.js`, `cluster-server.js`) where CI, Docker and tenant userData expect them.

Non-goals for the move batches: merging the business/visitor forks, splitting files over 500 lines, deduplicating helpers, and security fixes. Those are listed as Track C code-change PRs and never mixed into a move PR.

Hard constraints:

- No Next.js route file (page, layout, loading, error, not-found, template, default, route.ts/tsx, metadata files) moves. Route files are only deleted, and only with owner sign-off (batch B3b).
- `src/middleware.ts` and `src/instrumentation.ts` stay at `src/` root.
- No route groups are introduced: providers are chosen by `ConditionalLayout` under one root layout, and middleware rewrites subdomains onto fixed segment names.
- No barrel `index.ts` that mixes client and server modules.
- One PR open at a time on the single working branch. Every PR compiles on its own.

## Target structure

```
src/
  middleware.ts                      pinned
  instrumentation.ts                 pinned
  app/                               URL tree unchanged
    layout.tsx page.tsx globals.css (base tokens only) icon.png apple-icon.png favicon.ico
    admin/
      layout.tsx page.tsx loading.tsx logout-action.ts    unchanged (tests import by path)
      <feature>/page.tsx + loading.tsx + <Feature>Client.tsx   existing convention
      <feature>/_components/          only when a route owns more than 3 private files
      orders/[id]/_components/        13 order-detail widgets (from components/admin)
      customers/[id]/_components/     9 customer-detail widgets (from components/admin)
      products/ProductsTableClient.tsx (+ list-only helpers)
      categories/CategoriesClient.tsx  labels/LabelsClient.tsx  offers/OffersListClient.tsx
      dashboard/_components/          AnalyticsDashboardClient + page-private widgets
      merchant-sync/_components/      from components/admin/merchant
      data-source/_components/        from components/admin/data-source
      review-forms/FormsPreview.tsx
      ecom/                           no kyc/ folder
    staff/
      layout.tsx  manifest.webmanifest/route.ts  notes/page.tsx
      notes/_components/              Staff*.tsx (8)
      notes/_lib/useStaffNoteDraft.ts
    ecom/
      layout.tsx (imports ./ecom.css)  ecom.css (ecom-only overrides from globals.css)
      _demo/  _sections/              renamed from demo/ and sections/
      dashboard/SiteReachabilityBadge.tsx
      apps/ onboard/ pricing/ signin/ signup/ ...
    certportal/                       + PortalSignIn.tsx, PortalSignOutButton.tsx
    forms/[slug]/                     + FormsTopNav.tsx
    account/orders/[id]/              + ReviewModal.tsx
    legal/                            routes only (policies.ts moves to lib)
    api/                              route.ts / route.tsx only (integrations/state.ts moves to lib)
    business/ products/ categories/ cart/ checkout/ invoice/ quotation/ purchaseorder/   unchanged
  components/                         code used by 2+ routes only
    ConditionalLayout.tsx DelhiveryTracking.tsx NumberInputWheelGuard.tsx PolicyConsentGate.tsx ThemeToggle.tsx
    admin/                            shared admin primitives and cross-page widgets (flat)
      dashboard/ (Primitives, Charts)  ecom/ (+ tabs/KycActionButtons.tsx)
      homepage/ (+ editors/)           site-controls/        both pinned, see Placement rules
    ui/                               + CheckMark.tsx, Linkify.tsx
    visitor/ business/ shared/ on-device/ portal/ security/   names unchanged
  hooks/                              useBarcodeScanner.ts
  contexts/                           minus AdminMobileContext/AdminMobileProvider
  types/                              google.d.ts, razorpay.d.ts, index.ts
  lib/                                flat root kept, existing feature folders kept
    legals/policies.ts                from app/legal/policies.ts (moved intact)
    oauth-state.ts                    from app/api/admin/integrations/state.ts
    review-summary.ts                 server half from components/visitor/pdp
    product-attribute-filters.ts (server) + product-attribute-filters-shared.ts (client-safe)
    icon-suggest.ts                   renamed from iconSuggest.ts
    admin-agent/tools/index.ts        was admin-agent/tools.ts
    client/                           browser-only: session-guard, admin-events, fp-beacon, google-oauth-popup
    on-device/                        unchanged (worker URLs are relative to runtime.ts)
tests/
  setup.ts
  helpers/                            homepage-draft-db.ts, pdf-mocks.ts, request.ts
  fixtures/
  middleware/                         the 5 middleware-*.test.ts
  instrumentation.test.ts
  api/<exact route path with [param] folders>/route.test.ts
  lib/<mirror of src/lib>.test.ts
  components/<mirror of src/components>.test.tsx
  app/<mirror of src/app>.test.ts
database/                             unchanged; migrations never renamed
deploy/                               *.sh, nginx*.conf, load-secrets.mjs, schema-diff.sh stay at root
  aws/                                aws-infrastructure.yaml, IAM JSON, cloudfront-*.js
  aws/lambda/{admin-proxy,support-websocket}/
docs/                                 adr/ audit/ ops/ runbooks/ plans/ archive/
scripts/                              flat (grouping is an open question)
root                                  Dockerfile, docker-compose.*.yml, server.js, cluster-server.js,
                                      next/tailwind/postcss/vitest/tsconfig, .prettierrc.json,
                                      .prettierignore, .editorconfig, .git-blame-ignore-revs
removed                               supabase/.temp, s3-bucket-policy.json (untracked), lambda/, public/css,
                                      public/ort (after confirmation)
```

## Placement rules

| Kind | Location |
|---|---|
| Next.js route file | Its URL position under `src/app`. Never moved for structure. Moving one is a URL change and needs its own PR plus updates to middleware.ts, scopes.ts, callers and the scope-coverage tests. |
| Primary client island of a page | `src/app/<segment>/<Feature>Client.tsx` beside page.tsx. Existing Admin/Page-prefixed names are kept. |
| Other page-private components, hooks, helpers (one route) | Up to 3 files: siblings of page.tsx. More than 3: `src/app/<segment>/_components/` (UI) and `_lib/` (hooks, helpers, data). |
| Component shared by sibling routes in one segment (add + edit) | `_components/` of the lowest common ancestor segment, but only if no file under `src/components` imports it. Otherwise it stays in `src/components`. |
| Non-route module under `src/app` | Only in an underscore-prefixed folder or as a page sibling. Never an unprefixed folder. |
| Server Action | Colocated `src/app/<segment>/actions.ts` with `'use server'`. Never inline in new page.tsx code, never in a `'use client'` file or a module a client imports. |
| Component used by 2+ routes in one surface | `src/components/<surface>/` (admin, visitor, business, portal), in a feature subfolder when 4+ files belong together. |
| Surface-neutral primitive (select, pagination, toggle, icon, link rendering) | `src/components/ui/`. Admin primitives stay in `components/admin` until a Track C merge removes the duplicates. |
| Shared client hook | `src/hooks/useXxx.ts` |
| React context | `src/contexts/<Name>Context.tsx`: named Provider plus `use<Name>` hook in one file. |
| Server logic (db, fs, AWS, secrets) | `src/lib/<kebab>.ts` or an existing `src/lib/<feature>/`. New domains with 3+ files get a folder. |
| Client-safe half of a server module | `src/lib/<name>-shared.ts`. The `.server.ts` suffix is retired. |
| Browser-only lib code | `src/lib/client/`. Exception: `src/lib/on-device/` stays whole. |
| Lib module with value importers in `'use client'` files (pricing, homepage-sections, gst, product-label, label-sizes, admin-path, business-path, format) | Stays isomorphic. Never gets `import 'server-only'`. |
| DTO types shared between a route and UI | `src/lib/<domain>.ts` or `-shared.ts` as `export type`. Never exported from a route.ts that UI imports, never from a page.tsx that a component imports. |
| Domain data used by lib | `src/lib`. `src/lib` never imports `src/app` or `src/components`. |
| Ambient declarations | `src/types/*.d.ts` |
| Route test | `tests/api/<route path with literal [param]>/route.test.ts`. Extra files: `route.<behaviour>.test.ts` in the same folder. |
| Lib / component / middleware / app test | `tests/lib/...`, `tests/components/...`, `tests/middleware/...`, `tests/app/...` mirroring source |
| Shared test helper or mock | `tests/helpers/` only |
| Schema DDL | `database/<topic>.sql`, `constraints.sql`, `indexes.sql`. Never add or rename migrations. |
| Deploy files referenced by Docker, compose, CI, userData | `deploy/` root |
| Hand-applied AWS artifacts | `deploy/aws/` |
| Docs | `docs/` current, `docs/plans/` plans, `docs/archive/` superseded, `docs/adr/NNNN-kebab.md` unique numbers |

Pinned exceptions to colocation (do not move):

- `src/components/admin/homepage/**`: `tests/components/section-editors.test.ts` runs readdirSync on it, `tile-list-reorder.test.tsx` imports it, and `components/admin/HeroSlideManager.tsx` imports `homepage/draft-events`.
- `src/components/admin/site-controls/**`: `CustomerTagDefinitionsCard.tsx` and `DelhiveryPageClient.tsx` import from it, and `section-card-collapse.test.ts` reads `controls.tsx` by path.
- `src/components/admin/ecom/**`: used by both `app/admin/ecom` and `app/ecom/dashboard`.
- `src/components/admin/dashboard/{Primitives,Charts}.tsx`: used by 13 CRM cards.

## Naming and formatting

### Naming (new files; existing files renamed only where a batch says so)

- Route segments: kebab-case; params `[id]` unless nested ids need a name. The `add/` vs `new/` and `edit/[id]` vs `[id]/edit` inconsistencies are URLs and are left alone. New CRUD routes use `new/` and `[id]/edit`.
- Components: PascalCase.tsx, one default-exported component per file. Multi-export kits (Primitives, Charts, EcomUI, controls, fields) are allowed and keep their names because tests read them by path.
- Page islands: `<Feature>Client.tsx`, no Admin/Page prefix on new files.
- Hooks: `useCamelCase.ts`. Lib modules: kebab-case.ts, named exports (redis keeps its default).
- Server/client markers: plain lib name = server; `-shared.ts` = client-safe; `src/lib/client/` = browser-only. New outbound API clients use `<service>-api.ts`; existing `ai-client`, `ec2-client`, `ssm-client` keep their names.
- Private folders under `src/app`: `_components`, `_lib`, `_demo`, `_sections`.
- Tests: kebab-case `*.test.ts(x)`; no `-part2`, `-more`, `-extra`, `-supplement` suffixes.
- Migrations: never renamed. New ones `YYYY-MM-DD_snake_case.sql`.
- Docs: new docs kebab-case.md. Existing UPPER_SNAKE docs keep names (CLAUDE.md cites them).
- Commits: conventional, for example `refactor(admin): colocate order-detail widgets`.

### Prettier

Values measured across 1,570 tracked src files: 0 semicolons (except `src/lib/validate.ts`), single quotes 6404:2, JSX attributes 100% double quotes, 2-space indent, LF, arrow params without parens in the large majority, about 5% of lines over 120 characters.

`.prettierrc.json`:

```json
{
  "semi": false,
  "singleQuote": true,
  "jsxSingleQuote": false,
  "tabWidth": 2,
  "useTabs": false,
  "trailingComma": "es5",
  "printWidth": 120,
  "arrowParens": "avoid",
  "bracketSpacing": true,
  "quoteProps": "as-needed",
  "endOfLine": "lf"
}
```

- No import-sorting plugin (it changes module evaluation order around `vi.mock` and CSS imports) and no `prettier-plugin-tailwindcss` (it would rewrite every className).
- `.prettierignore`: `.next`, `node_modules`, `coverage`, `graphify-out`, `public`, `database`, `ai-platform`, `package-lock.json`, `CHANGELOG.md`, `*.md`, `*.sql`, `*.yml`, `*.yaml`, `docs`.
- `.editorconfig`: `root=true`; `[*]` charset utf-8, end_of_line lf, indent_style space, indent_size 2, insert_final_newline true, trim_trailing_whitespace true; `[*.md]` trim_trailing_whitespace false.
- npm scripts: `format` (`prettier --write .`) and `format:check` (`prettier --check .`).
- Adoption: formatting-only PRs F1-F5, one per folder, each commit SHA added to `.git-blame-ignore-revs`. After F5, CI runs `format:check`. Move PRs never reformat, so git rename detection keeps history.

### ESLint (existing `eslint-plugin-import` via `eslint-config-next`, no new deps)

- `import/order` (warn): groups builtin, external, internal (`@/**`), parent, sibling, index, type; `newlines-between: ignore`; no alphabetising. Matches the order 818 of 951 mixed files already use.
- `no-restricted-imports` (warn) on `../*` inside `src`: siblings use `./`, everything else uses `@/`.
- `import/no-restricted-paths` (warn in B0, error after B5): `src/lib` may not import `src/app` or `src/components`; `src/components` may not import `src/app`; nothing outside tests imports `@/app/api/**`. The rule also applies to `import type`.
- `'use client'` / `'use server'` stay on line 1, single-quoted. Type-only imports from server modules use `import type`.
- `import 'server-only'` is added only to modules outside the middleware graph that no client imports (the `*-pdf.ts` modules, `email.ts`, `review-summary.ts`). No blanket rule.
- Vitest alias: `'server-only'` -> `next/dist/compiled/server-only/empty.js` (already in node_modules).

## Cleanup

Verified dead or junk (batches B1/B2, re-grep after #507 merges):

- `supabase/.temp/*` (8 files; exposes project ref and pooler host). Add `supabase/.temp` to `.gitignore`.
- `s3-bucket-policy.json` via `git rm --cached` (already gitignored; public copy of a policy granting Principal `*` Put/Delete).
- `src/lib/admin-agent/tools/*-approve-cases.md` (5 stale merge notes).
- `docs/planning/product-import-template.xlsx` (the template route generates the file).
- `public/css/{bootstrap.min.css,style.css}` (no references).
- `tests/helpers/{auth,db,next}.ts` (0 importers) and the byte-identical `tests/api/admin/invoices/drafts/id/finalize.test.ts`.
- tsconfig include `.next-verify/types/**/*.ts` (directory does not exist).
- Components: admin `BatchSerialLabelModal`, `CustomerContactForm`, `DeleteProductButton`, `MerchantSyncStatus`, `NavigationLoader`, `StoreRulesForm`, `dashboard/MoreActionsMenu`; business `BusinessDiscountBanner`, `RecommendedProducts`; `ui/Button`; visitor `AddToCompareButton`, `CompareDrawer`, `MobileFilterToggle`, `ProductViewControls`, `RequestQuoteButton`. Fix the comment in `BatchSerialLabels.tsx`.
- App non-route modules: `admin/crm/CrmCampaignPanel.tsx`, `admin/replication/AdminReplicationClient.tsx`, `checkout/page-new.tsx`, `ecom/LandingMocks.tsx`.
- `admin/replication/loading.tsx` (loading screen of a redirect-only page; page.tsx stays, URL unchanged).
- `src/contexts/AdminMobileContext.tsx` + `AdminMobileProvider.tsx` (never read) and the provider mount in `admin/layout.tsx`.
- Test-only lib modules with their tests: `websocket`, `pricing-engine`, `auth-guard`, `social/content`, `admin-agent/dynamic-tools`.
- `scripts/smoke-customer-assistant.mjs` (imports missing `src/lib/ai-assistant.ts`); fix stale comments in `smoke-ai-assistant.mjs`.
- `.ecom-accent-ring` in `globals.css`; always-false `shouldShowFooter()` branch in `ConditionalLayout.tsx`.
- No-op `vi.mock('./db')` in `tests/lib/admin-crm.test.ts` and `tests/lib/product-offers.test.ts`.

Owner confirmation required (batch B3):

- `src/app/admin/ecom/billing/[id]/{AccountModeToggle,DeliveryModeToggle}.tsx` (unimported since d35f68fe; may be tied to #507) and their `ALLOWED_WITHOUT_CLIENT_GATE` entries.
- `src/components/visitor/listing/{QuickFilterChips.tsx,quick-filters.ts}` + test (possibly unwired engagement work).
- `public/ort/*` (22 files, about 15 MB; workers load `/models/onboarding/ort/`).
- Route deletions (URL removal intended): `ecom/preview/**` (10), `account/orders/confirmation`, `dev/on-device` (or gate it), `business/catalog`, `business/orders` (repoint `business/support/page.tsx:91` first), `api/internal/provisioning/advance`, `api/cron/{reconcile-settlements,pool-autoscale}`, `api/admin/diag-embeddings`, `api/business/token/generate`, plus their tests and the unreachable `getScopeForPath` entries in `scopes.ts`.

Code-change consolidations (Track C, never in move PRs): mailer panels, coupon user pickers, admin vs ui Pagination, AdminImage vs StoreImage, business/visitor forks and forked business pages, formatINR/formatDate/inputCls copies, PDF helpers and pdfkit loader, pg Pool factory, SigV4 plumbing, CRON_SECRET checks, Google token verifiers (keep the admin `email_verified` check), `normalizeIndianPhone`, route-local helpers (`fireRouteTransfer`, `calcTotals`, `buildQuoteNumber`, `buildRfqNumber`, `buildToolsDef`, `isSameOriginRequest`, `guard`, `resolveUserId`).

## Migration batches

Prerequisite for all batches: PR #507 merged, `main` pulled into the working branch, and the importer greps re-run.

| ID | Title | Est. moves | Risk | Prerequisites |
|---|---|---|---|---|
| B0 | chore(tooling): Prettier, EditorConfig, lint rules, server-only alias | 0 | low | #507 merged |
| B1 | chore: remove tracked junk, dead helpers, duplicate test | 21 | low | B0 |
| B2 | refactor: delete verified-dead components, modules and tests | 35 | low | B1 |
| F1 | style: format tests/ | 0 | low | B2 |
| F2 | style: format src/lib, middleware, instrumentation, types, contexts | 0 | low | F1 |
| F3 | style: format src/components | 0 | low | F2 |
| F4 | style: format src/app/api | 0 | low | F3 |
| F5 | style: format rest of src/app; enforce format:check in CI | 0 | low | F4 |
| B3a | chore: owner-confirmed non-route removals | 27 | medium | F5, owner sign-off |
| B3b | chore: owner-confirmed route removals (URL removal intended) | 20 | medium | B3a, owner sign-off |
| B4 | test: merge overlapping route tests at the mirrored path | 30 | medium | F5 |
| B5 | refactor: fix inverted dependencies, lint boundary to error | 5 | low | B4 |
| B6 | refactor(admin): colocate order-detail and customer-detail widgets | 22 | low | B5 |
| B7 | refactor(admin): colocate page-level clients from components/admin | 24 | low | B6 |
| B8 | refactor: colocate staff, certportal, forms, account single-surface components | 15 | low | B7 |
| B9 | refactor(ecom): private non-route folders and ecom-only CSS | 16 | medium | B8 |
| B10 | refactor(lib): server/client markers and lib outliers | 12 | medium | B9 |
| B11 | test: mirror tests/api paths and gather middleware tests | 60 | low | B10 |
| B12 | chore(ops,docs): group AWS artifacts, archive superseded docs | 14 | low | B11 |

Total structural moves and deletions: about 300. Track C follows.

### Batch details

**B0 - tooling (no source changes).** Add `.prettierrc.json`, `.prettierignore`, `.editorconfig`, empty `.git-blame-ignore-revs`. Add `prettier` to devDependencies (owner runs `npm install`; validate with `npm ci` because of the npm 11.5.1 edgesOut crash). Add `format` / `format:check` scripts. Extend `.eslintrc.json` with the three rules at warn. Add the vitest `server-only` alias. Remove the `.next-verify` tsconfig include. In `tests/lib/admin-client-write-gate.test.ts`, replace the hardcoded minimum with the count measured now so a later move cannot silently shrink coverage. If a new top-level UI folder is ever added, extend `tailwind.config.ts` content in the same PR (this plan adds none that carry classes; `src/hooks` has none).

**B1 - junk.** Everything in the first cleanup list that is not source code: `supabase/.temp`, `s3-bucket-policy.json`, approve-cases notes, the xlsx, `public/css`, dead test helpers, the duplicate finalize test. Annotate the `s3-bucket-policy` mention in `docs/PROVISIONING_ENGINE_PLAN.md`.

**B2 - dead code.** All verified-dead components, app non-route modules, `replication/loading.tsx`, the AdminMobile pair (plus layout edit), test-only lib modules with their tests, the broken smoke script, `.ecom-accent-ring`, the dead Footer branch, the no-op `vi.mock('./db')` lines. Before deleting, run `git grep -lw <Name> -- src tests scripts` for each basename.

**F1-F5 - formatting-only.** `prettier --write` on one folder per PR, no other edits, SHA recorded in `.git-blame-ignore-revs`. Fix `src/lib/validate.ts` and the 4 files missing a final newline as part of the sweep. F5 adds a `format:check` step to `.github/workflows/ci.yml` gated like lint. If the owner prefers format-on-touch (open question), F1-F5 are dropped and CI checks only changed files.

**B3a / B3b - owner-confirmed removals.** Split so non-route deletions and URL removals review separately. B3b also removes the unreachable `getScopeForPath` entries and repoints the business support link. Grep `deploy/`, `.github/`, `src/lib/cron-jobs.ts` and `src/app/api/admin/cron/trigger/route.ts` for each removed API path.

**B4 - test merges.** One file per route at the mirrored path for the 13 overlapping groups: agent `actions/[id]/approve` (4 files, split by behaviour to stay under 500 lines), audit, delhivery `sync-statuses`, orders `create-shipment`, products `[id]/bootstrap-stock`, quotations `[id]/convert-to-invoice`, orders `[id]/invoice`, orders `[id]`, orders `create`, products `[slug]`, webhooks `razorpay`, and `business/customers/[id]/approve` (from `orders/approve-route.test.ts`). Move `tests/lib/__pdf-mocks.ts` to `tests/helpers/pdf-mocks.ts`. Test count may drop only by removed exact duplicates.

**B5 - inverted dependencies.**
- `src/app/legal/policies.ts` -> `src/lib/legals/policies.ts`, moved intact (no split, so the 8 `vi.mock('@/app/legal/policies')` factories only change their string). Update 9 API routes, `lib/legals/generate.ts`, `lib/policy-pdf.ts`, `legal/page.tsx` and `legal/[slug]/page.tsx` (`'../policies'` -> alias), and 3 test imports.
- `src/app/api/admin/integrations/state.ts` -> `src/lib/oauth-state.ts`; update 6 routes and `return-to-admin.test.ts`.
- `src/app/admin/ecom/kyc/KycActionButtons.tsx` -> `src/components/admin/ecom/tabs/`; update `KycTab.tsx` and the write-gate allowlist path; remove the empty `kyc/`.
- `ShipmentRow` type: move out of `src/app/admin/ecom/customers/[id]/page.tsx` into a lib `-shared` module; `ShipmentsTab.tsx` and the page import it from there.
- `CheckMark`: extract from `src/app/ecom/Shapes.tsx` to `src/components/ui/CheckMark.tsx`; `Shapes.tsx` re-exports it; `PortalBrandPanel` imports the ui path.
- `PickerProduct` / `PreviewItem`: move out of `api/admin/homepage/{products,preview}/route.ts` into `src/lib/homepage-sections.ts` as type exports.
- `AdvancedFilterField`: move from `components/admin/AdvancedFilterPanel.tsx` into `src/lib/product-attribute-filters.ts` (client-safe after B10 rename).
- Promote `import/no-restricted-paths` to error.

**B6 - admin detail widgets.** Re-verify single importers, then move the 13 order-detail files (`AddressChangeReview`, `CancelReview`, `CodRemittanceButton`, `CreateShipmentButton`, `CustomerMailPanel`, `ExtendEddButton`, `GenerateInvoiceButton`, `InitiateRefundButton`, `MailLogsPanel`, `RetryPaymentEmailButton`, `ReturnReview`, `UpdateOrderStatus`, `VariantChangeRequest`) to `admin/orders/[id]/_components/` and the 9 customer-detail files (`CustomerActionButton`, `CustomerAiSummary`, `CustomerConversations`, `CustomerEngagementChips`, `CustomerMailerPanel`, `CustomerTags`, `CustomerTasks`, `CustomerTimeline`, `HealthScoreCard`) to `admin/customers/[id]/_components/`. Convert `UpdateOrderStatus`'s `'../ui/Toggle'` to the alias. Update write-gate allowlist paths and vi.mock strings.

**B7 - page-level clients.** `ProductsTableClient` (+ list-only helpers) -> `admin/products/`; `CategoriesClient` -> `admin/categories/`; `LabelsClient` -> `admin/labels/`; `OffersListClient` -> `admin/offers/`; `CouponEligibleUsersClient` + `CouponUserPicker` -> the eligible-users route folder; `AnalyticsDashboardClient` + dashboard-only widgets -> `admin/dashboard/_components/` (Primitives, Charts stay); `merchant/*` -> `admin/merchant-sync/_components/`; `data-source/*` -> `admin/data-source/_components/`; `forms/FormsPreview` -> `admin/review-forms/`. Move `useBarcodeScanner.ts` to `src/hooks/`. Update the write-gate allowlist (`ProductsTableClient`, `LabelsClient`).

**B8 - single-surface components.** `src/app/staff/Staff*.tsx` -> `staff/notes/_components/`, `useStaffNoteDraft.ts` -> `staff/notes/_lib/`; `SiteReachabilityBadge` -> `app/ecom/dashboard/`; `PortalSignIn`, `PortalSignOutButton` -> `app/certportal/`; `FormsTopNav` -> `app/forms/[slug]/`; `shared/ReviewModal` -> `app/account/orders/[id]/`. Remove `src/components/forms` if empty. `NoteAttachments` moves only if staff is its sole importer.

**B9 - ecom.** Rename `ecom/demo` -> `_demo`, `ecom/sections` -> `_sections` (only `ecom/page.tsx` imports them). Convert the 13 `'../'` imports in ecom and legal to `@/app/ecom/...`. Move `.ecom-clean`, `.ecom-accent-*` and `.ecom-scope` overrides from `globals.css` to `app/ecom/ecom.css` imported by `ecom/layout.tsx`.

**B10 - lib markers and outliers.**
- `admin-agent/tools.ts` -> `admin-agent/tools/index.ts` (specifier unchanged; fix relative imports). Keep the FORBIDDEN regex at lines 875 and 929 working and check that runtime path strings into `src/app/api/admin` still resolve.
- `components/visitor/pdp/review-summary.server.ts` -> `src/lib/review-summary.ts` with `import 'server-only'`.
- `product-attribute-filters.ts` -> `product-attribute-filters-shared.ts`; `product-attribute-filters.server.ts` -> `product-attribute-filters.ts`.
- `iconSuggest.ts` -> `icon-suggest.ts`.
- `admin-events-client.ts`, `fp-beacon.ts`, `google-oauth-popup.ts` -> `src/lib/client/`.
- `src/lib/linkify.tsx` -> `src/components/ui/Linkify.tsx` (it carries Tailwind classes and `src/lib` is outside the content globs).
- Add `import 'server-only'` to the `*-pdf.ts` modules and `email.ts` only.
- `AdminShortcutHandler.tsx`: change to `import type { KeyboardShortcuts }`. `EconomicsCard.tsx`: import `CRM_SEGMENT_KEYS` from `crm-insights-shared` (move the constant there if it is not already exported).
- Update every vi.mock string for moved specifiers.

**B11 - test mirroring.** Rename every `tests/api/**/id/` to `[id]/`, move misplaced single-route tests to their mirrored path (for example `customers/activity` -> `customers/[id]/activity`, `pincode` -> `pincode/[pin]`), unify `.route.test.ts` and `[id].test.ts` variants, rename `-part2`/`-more`/`-db2`/`-extra`/`-supplement` files by behaviour, move the 5 middleware tests to `tests/middleware/`. Split into B11a (admin) and B11b (rest) if over 60 files. Add a small script check that every `tests/api/**/route.test.ts` has a matching `src/app/api/**/route.ts`.

**B12 - ops and docs.** `deploy/{aws-infrastructure.yaml,ec2-iam-policy.json,tenant-provisioner-iam-policy.json,cloudfront-*.js,lambda/admin-proxy}` and `lambda/support-websocket` -> `deploy/aws/` (grep ci.yml, compose, docs first; no `.sh`, `.conf` or `load-secrets.mjs` moves). `docs/{SAAS_MULTITENANT_PLAN,PROVISIONING_ENGINE_PLAN,PROXY_ASG_PLAN}.md` -> `docs/archive/` and update CLAUDE.md, including the `MULTI_TENANT_PHASES.md` pointer. Merge `docs/planning` into `docs/plans`. Renumber the second ADR 0002. Fix the stale `psql -f database/migrations/mailer.sql` hint in `admin/mailer/page.tsx`.

### Track C - code-change PRs (after B12, one concern per PR)

| ID | Title | Risk |
|---|---|---|
| C1 | fix(api): add `requireAdminScope` in place to the admin-only handlers outside `/api/admin` (brands, categories writes, gallery, upload, generate-image, orders `[id]` refund/cancel-review/return-review/PATCH, razorpay payment-link, products `[id]` PATCH/DELETE) and extend `admin-write-scope-audit.test.ts` to glob them. No URL change. | high |
| C2 | fix(api): payables webhook in place: middleware public-path entry, fail-closed signature, `timingSafeEqual`; in-handler auth for the 3 audit mail-log/message-log routes | high |
| C3 | refactor: `verifyCronRequest` with `timingSafeEqual` replacing 29 inline CRON_SECRET checks | medium |
| C4 | refactor: shared `formatINR`/`formatDate`/`numberToWords` in `src/lib/format.ts` and an admin input class | low |
| C5 | refactor(admin): extract inline Server Actions into colocated `actions.ts` (products edit/add first, then brands, categories, coupons, review-forms) | medium |
| C6 | refactor(lib): split god modules behind stable specifiers: `email/index.ts`, `queries/index.ts`, `tenant-registry/index.ts` (middleware keeps the index specifier so its mocks apply), one PR each | high |
| C7 | refactor: split files over 500 lines, one file per PR (AdminAuditClient by tab, InventoryClient, InvoicesClient, FinancialClient, QuotationsClient, ProductForm, CheckoutReviewPage, the agent approve route) | medium |
| C8 | refactor(storefront): merge business/visitor page and component forks behind a portal prop, one pair per PR, starting with addresses and transactions | high |
| C9 | refactor(lib): single pg Pool factory and shared SigV4 plumbing | high |

## Verification per batch

Commands are named here; per house rules they run only when the owner asks in that session. Never test against live RDS; local DB only (port 5432). Never delete `.next`.

Every batch:

1. `npx tsc --noEmit`
2. `npm run lint` (no new errors; after B5 the boundary rule must be clean)
3. For every moved or deleted specifier: `git grep -n "<old specifier>" -- src tests scripts` returns nothing, including `vi.mock` / `vi.doMock` strings
4. `graphify update .`
5. Before merge of any batch touching tests or mock strings: full `npm test`, with the test count recorded in the PR

| Batch | Targeted tests | Smoke checks (dev server) |
|---|---|---|
| B0 | `tests/lib/admin-client-write-gate.test.ts`, `tests/lib/admin-page-scope-coverage.test.ts`; `npx prettier --check` on two representative files shows near-zero diff | none |
| B1 | `tests/api/admin/invoices/drafts`, `tests/lib/admin-agent` | none |
| B2 | `tests/lib/admin-client-write-gate.test.ts`, `tests/lib/admin-page-scope-coverage.test.ts`, `tests/components`, `tests/lib` | `/admin/replication` still redirects, `/admin`, `/checkout`, ecom landing |
| F1-F5 | full suite after F1 and F5; folder suite after F2-F4; `npx prettier --check <folder>` | none (zero logic change; diff reviewed as whitespace/punctuation only) |
| B3a | `tests/lib/admin-client-write-gate.test.ts`, `tests/components` | on-device onboarding still loads model and ORT from `/models/onboarding/ort/`; no 404s for `/ort/` or `/css/` |
| B3b | `tests/lib/admin-write-scope-audit.test.ts`, `tests/lib/scopes*`, `tests/middleware*`, `tests/api/internal`, `tests/api/cron` | removed URLs return 404; `/`, `/products`, `/business`, `/business/support` link, `/ecom`, `/admin/dashboard` return 200 or redirect |
| B4 | the touched `tests/api/...` directories | none |
| B5 | `tests/api/legal`, `tests/lib/policy-pdf.test.ts`, `tests/api/admin/integrations`, `tests/api/admin/data-source`, `tests/api/admin/social`, `tests/api/admin/homepage`, `tests/lib/admin-client-write-gate.test.ts` | `/legal`, `/legal/<slug>` and its PDF, an OAuth connect redirect, `/admin/ecom/customers/<id>` KYC and shipments tabs, certportal sign-in panel, Settings > Homepage product picker |
| B6 | `tests/lib/admin-client-write-gate.test.ts` (count must not drop), `tests/components/admin` | `/admin/orders/<id>` every action renders, `/admin/customers/<id>` |
| B7 | `tests/lib/admin-client-write-gate.test.ts`, `tests/components`, `tests/api/admin/products` | `/admin/products`, `/admin/categories`, `/admin/labels`, `/admin/offers` both tabs, `/admin/dashboard`, `/admin/merchant-sync`, `/admin/data-source`, `/admin/review-forms/add`, barcode scan screen |
| B8 | `tests/components`, `tests/app` | `/staff/notes` desktop and mobile widths, `/staff/manifest.webmanifest`, certportal sign-in/out, a `forms-<slug>` form, `/ecom/dashboard`, `/account/orders/<id>` review modal |
| B9 | lint shows no `../` warnings in `src/app/ecom` | ecom `/`, `/apps`, `/apps/<slug>`, `/apps/products`, `/pricing`, `/signin`, `/signup`, `/onboard` in light and dark; storefront home unchanged |
| B10 | `tests/lib/admin-agent`, `tests/lib/product-attribute-filters*`, `tests/lib/*pdf*`, `tests/lib/email*`, `tests/components` | `/products/<slug>` review summary, admin product filters, Google OAuth popup sign-in, admin agent chat (a forbidden path such as `src/lib/jwt.ts` is still refused), admin keyboard shortcuts |
| B11 | `tests/api`, `tests/middleware`; file and test counts identical before and after | none |
| B12 | CI guard that checks referenced `(.github/scripts|deploy)/*.sh` still passes; `docker compose -f docker-compose.infra.yml config` parses | markdown links in CLAUDE.md and docs resolve |

## Risks

- **Collision with PR #507.** It touches CrmMailerPanel, CouponForm, products add/edit pages, `billing/[id]`, package.json and package-lock. Start only after it merges and re-run every zero-importer grep.
- **Silent mocks.** A stale `vi.mock('@/lib/x')` string does not fail type-checking; the mock just stops applying. Step 3 of verification is mandatory in every move PR.
- **Security guard tests shrink quietly.** `admin-client-write-gate` (allowlist, globs, minimum count), `admin-page-scope-coverage`, `admin-write-scope-audit`, `nav-scope-alignment`, `editable-keys`, `blurhash-components`, `section-card-collapse`, `section-editors`, `tile-list-reorder`, `cart-saved-for-later-scope` and `route-linked-account-fallback` read files by path. Update them in the same PR; B0 pins the write-gate count.
- **Admin-agent denylist.** `src/lib/admin-agent/tools.ts` lines 875 and 929 match `lib/jwt.ts`, `lib/auth*`, `lib/db.ts`. Moving auth modules out of `src/lib/auth*` would expose them to the agent's file tools. This plan moves none; any future lib regroup must update the regex in the same PR.
- **Client/server boundary.** No blanket `server-only` and no "lib never imports X" rule beyond the app/components ban: `jwt`, `db`, `session-binding-gate`, `session-signals-request` and `scopes-server` import `auth-sessions`, `session-binding`, `audit-context` and `plan-gate`, and `pricing`, `homepage-sections`, `gst`, `product-label`, `label-sizes` have value importers in `'use client'` files. Middleware also bundles modules that `tenant-registry` and `db` import dynamically.
- **Tailwind purge.** Content globs cover `src/app`, `src/components`, `src/pages` only. Every component stays inside those roots; `linkify.tsx` moves into them.
- **Relative imports.** 270 relative imports in lib, `'../'` in ecom, legal, `admin/ecom/tabs` and `UpdateOrderStatus`. Convert cross-folder imports to `@/` in the moving PR.
- **Pinned paths.** `src/lib/ioredis-stub.js` (next.config.js), `src/lib/tenant-migrations(-schema).ts` and `src/app/api/internal/migrations/` (ci.yml regex and curls), on-device workers, `database/` and migration filenames, `certs/` and `public/{images,fonts}` (process.cwd reads), Dockerfile COPY targets, compose mounts, `deploy/*.sh`, `server.js`, `cluster-server.js`, `next.config.js` `outputFileTracingIncludes` route key. None move.
- **External URLs.** Razorpay, RazorpayX and Twilio webhooks, Google OAuth redirects (`/auth/google/callback`, `/api/admin/*/callback`), Razorpay `callback_url` pages. No batch changes them; B3b deletes only confirmed-orphan routes.
- **Formatting churn.** F1-F5 touch most files and stall any other branch. Land them back to back with nothing else in flight, record SHAs in `.git-blame-ignore-revs`, and review diffs as whitespace/punctuation only.
- **Public repo history.** Removing `s3-bucket-policy.json` and `supabase/.temp` from the tip does not purge history; the live bucket policy needs a separate review.
- **graphify-out** indexes every path; each PR must run `graphify update .`, which adds a large generated diff while it stays tracked.
- **CI minutes.** About 20 serial PRs at about 40 Actions minutes per main pipeline.

## Open questions

1. Formatting adoption: per-folder sweep F1-F5 (this plan's default) or format-on-touch with a changed-files CI check only?
2. `printWidth` 120 (fewest reflows) or 100?
3. Confirm each B3 removal: `ecom/preview/*`, `account/orders/confirmation`, `dev/on-device` (delete or gate in middleware), `business/catalog`, `business/orders`, `api/internal/provisioning/advance`, `api/cron/{reconcile-settlements,pool-autoscale}`, `api/admin/diag-embeddings`, `api/business/token/generate`, `public/ort`, QuickFilterChips, AccountModeToggle/DeliveryModeToggle.
4. Is `NEXT_PUBLIC_ONDEVICE_MODEL_BASE` ever set to the origin root in any environment (which would make `public/ort` live)?
5. Keep `graphify-out` tracked, or untrack it and generate it locally (CLAUDE.md and `.claude` hooks expect it to exist)?
6. `s3-bucket-policy.json`: remove only, or also keep a reviewed copy under `deploy/aws/`? Review the live bucket policy (Principal `*` Put/Delete)?
7. Security fix for admin-only handlers outside `/api/admin`: in-place `requireAdminScope` (C1, recommended, no URL change) or a later URL move? The move targets already exist, so it would be a handler merge.
8. Is a later `src/lib` domain regroup (auth, tenancy, payments, orders, documents, ...) wanted after Track C? If yes, it must keep auth under `src/lib/auth*` or update the agent denylist, and must exempt client-consumed modules from `server-only`.
9. Rename `src/components/visitor` to `storefront` (about 90 files) or keep the name?
10. Group `scripts/` into `smoke/`, `ml/`, `data/`, `ops/`? `seed-ss202.mjs` is referenced by `seed-ss202.yml`.
11. The blanket `*.sh` and `/scripts/` ignores leave `deploy/maintenance.sh`, `deploy/scheduler-setup.sh` and the ai-platform guard scripts untracked though docs reference them. Review them for secrets and track them?
12. `next lint` is deprecated in Next 15.5. Migrate to the ESLint CLI (and lint `tests/`) as part of B0, or later?
13. Should vitest coverage include `src/**/*.tsx` (currently only `.ts`)?
