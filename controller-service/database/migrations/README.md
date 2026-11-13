# Migrations

A migration is a one-off SQL file for what the schema files cannot express: destructive changes (drop or rename a
column or table, change a column type) and data changes (backfills, fixes). New tables, columns, constraints and
indexes do not go here: put them in the schema files (`<service>/database/tables/`, `constraints.sql`,
`indexes.sql`, ...) and the schema diff applies them.

## Writing one

- Put it in the `database/migrations/` folder of the service that owns the tables it touches
  (`docs/DATABASE_OWNERSHIP.md`). One that touches a platform-only table goes in that service's
  `database/platform-only/migrations/` instead: it runs on the flagship only, never on a store tenant.
- Name it `YYYY-MM-DD_what.sql`. The basename must be unique across every service: migrations from all services
  run as one list sorted by basename, and `node scripts/db-files.mjs migrations` fails on a duplicate.
- Make the SQL idempotent (`IF EXISTS`, `IF NOT EXISTS`, `ON CONFLICT`), so a re-run after a partial failure is safe.
- When it changes structure, change the schema files in the same commit, so they describe the end state.

## How they run

- Flagship (`jeffi_stores`): `deploy/k8s/db/release-db.sh --migrations` runs `deploy/run-migrations.sh` in the
  release pipeline.
- Store tenant databases: the controller's fan-out (`/api/internal/migrations/files-fanout`, called by
  `deploy/k8s/db/40-tenant-fanout.sh`), with the tenant set only (`node scripts/db-files.mjs migrations tenant`).
- Each database records applied files by basename in `schema_migrations`; only files missing from it run.
- Never run a migration by hand against RDS. Try it on the local database first.

## Removing one

Delete the file once it is applied everywhere: its basename is in `schema_migrations` on the flagship and on every
tenant database, and the schema files already describe what it left behind. An empty folder is fine.

## Held

`held/` is never loaded. A destructive migration that should wait for a person (after a live inventory and a
backup) sits there until it is moved into this folder in the release that should carry it. Today:
`2026-11-13_drop_platform_tables_from_stores.sql` (`docs/SAAS_MULTITENANT_STATUS.md`, Converging existing store databases).
