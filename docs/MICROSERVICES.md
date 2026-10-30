# Microservices — current scope

## Where we are today

**Only the SERVICES are segregated. The DATABASE is unified.**

Services:
- Four Next.js apps, sharing their code through `packages/store-core` (lib, components, contexts, hooks, the middleware).
  Code only the control plane uses (provisioning, compute, tenant migrations, the ecom console's components and
  overviews) lives in `controller-service/src/{lib,components}` as `@controller/...`, so store pods never ship it. An app
  imports store-core (`@/`) and itself, never another app: ESLint enforces it on `src`, and
  `packages/store-core/tests/lib/app-import-boundaries.test.ts` on everything including tests.
  - `controller-service` — the control plane only: the ecom console (`ecom.`), the certificate portal, the platform admin pages (`admin.<root>/ecom`, `/settings/{ai,compute}-pricing`), provisioning, platform crons and webhooks
  - `storefront-service` — the store's site (store host, custom domains, `vault-`, `forms-`) and every store `/api` route; admin and business UIs call those on their own host
  - `admin-service` — the admin panel, `/api/admin` and the store's crons
  - `business-service` — the B2B portal's pages (`{slug}.business.`)

  Who answers what is one table, `routeFor` in `packages/store-core/src/lib/service-routing.ts`: each app's middleware
  404s anything else, and the local dev router and the ingress route by it.

  Each project keeps its tests beside it: `<app>-service/tests` and `packages/store-core/tests` (unit, mirroring
  `src`), `<project>/integration-tests` (`npm run test:integration`). A route test lives in the app that owns the
  route; lib, component, hook and middleware tests in store-core; an audit with the tree it scans. The root
  `vitest.config.ts` runs them all as projects (`npx vitest --project admin` runs one).
- `messaging-service` (SMS/email/WhatsApp send + templates library)
- `document-service` (invoice/quotation/PO rendering + storage)
- `public-api-service` (the public API gateway, `public.jeffistores.in`)
- `mobile-service` (the mobile backend, `mobile.jeffistores.in`: the only host the Play Store app talks to; `/v1/app/*` is native, `/api/*` is forwarded to the storefront in-cluster until each route gets its own handler). The Expo app itself lives in `mobile-service/client` and is built by EAS, not in an image.

Each runs as its own k8s pod, from its own image (the four Next apps share `deploy/next-app.Dockerfile`, built with
`APP=<app>-service`). The platform's are `jeffi-stores-<service>-service` (namespace `jeffi`): the controller plus the
flagship's storefront, admin and business. Each store tenant runs `{slug}-{storefront,admin,business,messaging,document}-service`
in `tenant-{slug}` (business only from Pro); public-api and mobile are shared. Traefik routes every host by path from the
same `ROUTES` table (`deploy/k8s/gen-routes.ts` renders the platform's, `lib/k8s/tenant-workload.ts` each store's), so a
store has no controller pod: control-plane paths on its hosts 404.

Every service connects to **the same database**:
- **Local**: `jeffi_production_ready` (port 5432)
- **Prod**: `jeffi_stores` (the control plane merges into it at go-live, see `GO_LIVE_RUNBOOK.md`)

That one DB holds every entity:
- **control-plane entity** — `tenants`, `plans`, `plan_features`, `owners`, `api_keys`, `tenant_infra`, `wallet_*`, `auth_sessions`
- **messaging entity** — `messages`, `message_events`, legacy `message_templates`
- **documents entity** — `documents`, `document_sequences`
- **templates library** — `template_*` (per-tenant copies), `platform_template_*` (singleton defaults), `pub_template_*` (public-API customer copies), `brand_theme`, `sms_dlt*`, `short_link`, `waba_capacity`, `wa_pricing`
- **business tables** — products, orders, campaigns, …

The DBs `jeffi_control_plane`, `jeffi_messaging`, `jeffi_documents` are **legacy** from an earlier design that jumped straight to per-service DBs. They should not be used. The service `.env.local` URLs now all point at `jeffi_production_ready`.

## Where we're going

**Multi-tenant.** When we onboard real tenants:
- Each **tenant** gets its own DB (e.g. `jeffi_tenant_<slug>`).
- Services still connect to the **main DB** for the control-plane entity (tenant registry, api keys, wallet, …).
- Services connect to the **tenant DB** for that tenant's business data (products, orders, templates).
- Resolution: the service-auth claim carries `tenant_id`; the service's tenancy resolver (`packages/tenancy`) opens a connection to the right tenant DB.

**Per-service DB split**: later. Not now. When traffic patterns force it, we'll peel `messaging-service` off into its own DB (send log is high-churn), `document-service` into its own, etc. The current unified DB is a conscious phase-1 choice.

## Rules

1. **New tables land in `jeffi_production_ready`** — via the main `database/*.sql` pipeline (topic file + `constraints.sql` + `indexes.sql`).
2. **Do not create new DBs.** `jeffi_control_plane`, `jeffi_messaging`, `jeffi_documents` are deprecated. Their schema files remain as historical references but are not applied against new DBs.
3. **Service `.env` DB URLs all point at `jeffi_production_ready`.** `CONTROL_PLANE_DATABASE_URL`, `MESSAGING_DATABASE_URL`, `DOCUMENTS_DATABASE_URL`, `DATABASE_URL` — all the same URL today.
4. **Apply only to LOCAL DB.** Never run DDL against the live RDS.
5. **Multi-tenant lives in the services, not the DBs.** When tenants arrive, each gets a dedicated DB; the service picks the right connection via the tenancy resolver using the `tenant_id` in the service-auth claim.
