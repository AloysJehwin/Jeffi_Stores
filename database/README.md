# database/

Only `extensions.sql` lives here. Every table belongs to a service and its SQL sits in that service's own
`database/` folder (`docs/DATABASE_OWNERSHIP.md` says which, and why):

```
<service>/database/
  tables/<topic>.sql     CREATE TABLE / CREATE SEQUENCE
  constraints.sql        primary keys, UNIQUE, CHECK, column defaults
  foreign-keys.sql       foreign keys (loaded last, once every key they point at exists)
  indexes.sql
  functions.sql, triggers.sql
  seeds/                 row data
  migrations/            one-off destructive or data changes (see its README.md)
  platform-only/         tables only the platform uses (flagship DB only, never a store tenant's), same layout
  control-plane/         controller-service only: the control-plane set, same layout
  legacy/                the retired per-service databases' schema; nothing loads it
```

`scripts/db-files.mjs` is the manifest: it finds every `database/` folder and prints the files in load order
(extensions, all tables, functions, triggers, indexes, constraints, foreign keys). The release scripts
(`deploy/schema-diff.sh`, `deploy/run-migrations.sh`, `deploy/k8s/db/`) and the controller's tenant fan-out
(`controller-service/src/lib/db-files.ts`, the same discovery) read the files through it, so a new file in the
right folder is picked up without listing it anywhere.

```
node scripts/db-files.mjs                    # platform set: the flagship DB (every database/ plus each platform-only/)
node scripts/db-files.mjs tenant             # tenant set: a store tenant's own DB (no platform-only/, no control-plane/)
node scripts/db-files.mjs control-plane      # the control-plane tables (flagship only)
node scripts/db-files.mjs migrations [tenant]   # sorted by basename; tenant leaves out platform-only/migrations
node scripts/db-files.mjs seeds [owner]
```

**Which set a table belongs in.** A table goes in `tables/` when a store service reads or writes it through the
tenant pool (`query` in `packages/store-core`, `@jeffi/tenancy`'s tenant pool) while serving a store: it then exists
in the flagship and in every store tenant's database. A table only the platform uses, or that store code reaches
only through `controlPlanePool()` / the flagship pool (the messaging send log, short links, bulk jobs, platform
invoices, the AI gateway cache, …), goes in `platform-only/`. A tenant-set table may not reference a platform-only
or control-plane table, and a tenant-set migration may not touch one (`controller-service/tests/lib/tenant-migrations-schema-files.test.ts`);
a data fix for a platform-only table goes in `<service>/database/platform-only/migrations/`.

A file placed directly in this folder (other than `extensions.sql`) is never loaded.
