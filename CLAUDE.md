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

- DDL lives in split, `pg_dump`-style schema files under `database/` — tables in a topic file (`catalog.sql`, `logs.sql`, `amazon.sql`, …), primary keys / CHECK constraints / sequence-owner ALTERs in `constraints.sql`, and indexes in `indexes.sql`. A schema pipeline applies these; **do NOT write migration files** in `database/migrations/` for new tables.
- To add a table: put `CREATE TABLE public.<name> (...)` (+ any `CREATE SEQUENCE`) in the topic schema file, its PK/CHECK in `constraints.sql`, and its indexes in `indexes.sql` — mirroring an existing table's split (e.g. the `merchant_*` / `amazon_*` tables). The pipeline handles applying them; never hand-run migrations.
- Apply only to the LOCAL DB (port 5432); never the live RDS.

## Microservices — services split, DB unified

**Today only the services are segregated (controller-service — the Next app — plus messaging-service, document-service and public-api-service). They ALL connect to the same DB** — `jeffi_production_ready` locally, `jeffi_stores` in prod (the control plane merges into it at go-live). Every entity (control-plane, messaging, documents, templates library, business tables) lives in that one DB. See `docs/MICROSERVICES.md`.

- Do NOT create new DBs. `jeffi_control_plane`, `jeffi_messaging`, `jeffi_documents` are legacy from an earlier design and are deprecated.
- New tables for any service go in the main `database/*.sql` pipeline (topic file + `constraints.sql` + `indexes.sql`), applied to `jeffi_production_ready` locally.
- `.env` DB URLs across every service all point at the same main DB.
- Per-service DB split and per-tenant DBs come later with multi-tenancy; resolved via `packages/tenancy` using the service-auth `tenant_id` claim.
- Each service is its own k8s pod: `jeffi-stores-<service>-service` for the platform, `{slug}-{controller,messaging,document}-service` per store tenant (public-api is shared). Releases run in GitHub Actions (`.github/workflows/ci.yml`): after approval on the `production` environment the deploy job applies production DB changes with the `deploy/k8s/db/` scripts (`release-db.sh`: schema diff + migrations; tenants via the rollout's fan-out), then `release.sh --rollout-only`. From a Mac the same scripts run by hand (`deploy/k8s/README.md`, Releasing). Never apply anything to the live RDS outside those scripts.
