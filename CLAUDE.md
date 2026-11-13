## Multi-tenant SaaS status

- **`docs/SAAS_MULTITENANT_STATUS.md` is the authoritative status** for the multi-tenant / provisioning work. Read it before answering anything about tenants, provisioning, or `ecom.jeffistores.in`.
- The older design docs ([`docs/archive/SAAS_MULTITENANT_PLAN.md`](docs/archive/SAAS_MULTITENANT_PLAN.md), [`docs/archive/PROVISIONING_ENGINE_PLAN.md`](docs/archive/PROVISIONING_ENGINE_PLAN.md), [`docs/archive/PROXY_ASG_PLAN.md`](docs/archive/PROXY_ASG_PLAN.md), and `docs/MULTI_TENANT_PHASES.md`, which is gitignored and exists only in local checkouts) still describe this work as **not started** — that is false and they carry SUPERSEDED banners. Use them for design rationale only.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Database schema

- Each table belongs to one service, and its DDL lives in that service's `<service>/database/` folder (owners listed in `docs/DATABASE_OWNERSHIP.md`). Root `database/` holds only `extensions.sql` and a README; any other file placed there is never loaded.
- Layout of `<service>/database/`: `tables/<topic>.sql` (CREATE TABLE / SEQUENCE), `constraints.sql` (PKs, UNIQUE, CHECK, defaults), `foreign-keys.sql` (loaded last), `indexes.sql`, `functions.sql` / `triggers.sql`, `seeds/`, `migrations/`. The control-plane tables sit under `controller-service/database/control-plane/` in the same shape; `legacy/` is never loaded.
- Two schema sets: the flagship DB gets every `<service>/database/` plus each `platform-only/` (and control-plane); a store tenant's DB gets the **tenant set**, `<service>/database/` without `platform-only/`. Put a table in `<service>/database/platform-only/` (same shape) when no store service uses it through the tenant pool (only the platform, or store code via `controlPlanePool()`/the flagship pool). `database/README.md` has the rule.
- `scripts/db-files.mjs` is the manifest: it discovers every `database/` folder and sets the load order (extensions → tables → functions → triggers → indexes → constraints → foreign keys) for each set (`platform` = flagship, `tenant`, `control-plane`). The release scripts, CI and the controller's tenant fan-out (`controller-service/src/lib/db-files.ts`, kept equal by a test) all read through it, so a file in the right folder is picked up without being listed anywhere.
- To add a table: put `CREATE TABLE public.<name> (...)` (+ any `CREATE SEQUENCE`) in the owning service's `tables/<topic>.sql`, its PK/CHECK in that service's `constraints.sql`, its FKs in `foreign-keys.sql` and its indexes in `indexes.sql`, mirroring an existing table. **Do NOT write a migration** for new tables, columns or indexes.
- Migrations (`<service>/database/migrations/`) are only for destructive or data changes: date-prefixed (`YYYY-MM-DD_what.sql`), safe to run twice, unique basename across all services (`schema_migrations` records the basename). Delete one once it is applied everywhere. See that folder's README.
- Apply only to the LOCAL DB (port 5432); never the live RDS.

## Microservices — services split, DB unified

**Today only the services are segregated (four Next apps — controller-service for the control plane, storefront-service, admin-service and business-service for the stores, sharing `packages/store-core` — plus messaging-service, document-service, public-api-service and mobile-service; the Expo app is `mobile-service/client`, built by EAS and released from the same main-merge pipeline). They ALL connect to the same DB** — `jeffi_production_ready` locally, `jeffi_stores` in prod (the control plane merges into it at go-live). Every entity (control-plane, messaging, documents, templates library, business tables) lives in that one DB. See `docs/MICROSERVICES.md`.

- Do NOT create new DBs. `jeffi_control_plane`, `jeffi_messaging`, `jeffi_documents` are legacy from an earlier design and are deprecated.
- New tables for any service go in that service's `database/` folder (see Database schema above). All of them still load into the one DB, `jeffi_production_ready` locally.
- `.env` DB URLs across every service all point at the same main DB.
- Per-service DB split and per-tenant DBs come later with multi-tenancy; resolved via `packages/tenancy` using the service-auth `tenant_id` claim.
- Each service is its own k8s pod: `jeffi-stores-<service>-service` for the platform, `{slug}-{storefront,admin,business,messaging,document}-service` per store tenant (public-api and mobile are shared). Releases run in GitHub Actions (`.github/workflows/ci.yml`): after approval on the `production` environment the deploy job applies production DB changes with the `deploy/k8s/db/` scripts (`release-db.sh`: schema diff + migrations; tenants via the rollout's fan-out), then `release.sh --rollout-only`. From a Mac the same scripts run by hand (`deploy/k8s/README.md`, Releasing). Never apply anything to the live RDS outside those scripts.
