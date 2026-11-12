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
  control-plane/         controller-service only: the control-plane set, same layout
  legacy/                the retired per-service databases' schema; nothing loads it
```

`scripts/db-files.mjs` is the manifest: it finds every `database/` folder and prints the files in load order
(extensions, all tables, functions, triggers, indexes, constraints, foreign keys). The release scripts
(`deploy/schema-diff.sh`, `deploy/run-migrations.sh`, `deploy/k8s/db/`) and the controller's tenant fan-out
(`controller-service/src/lib/db-files.ts`, the same discovery) read the files through it, so a new file in the
right folder is picked up without listing it anywhere.

```
node scripts/db-files.mjs                 # platform set (the store schema, also what tenant databases get)
node scripts/db-files.mjs control-plane   # the control-plane tables
node scripts/db-files.mjs migrations      # all services, sorted by basename
node scripts/db-files.mjs seeds [owner]
```

A file placed directly in this folder (other than `extensions.sql`) is never loaded.
