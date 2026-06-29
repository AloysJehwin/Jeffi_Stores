# Schema modules

Source of truth for the database schema, split by domain. Generated from a `pg_dump --schema-only` of the live RDS database on 2026-05-24.

## Apply order
Files apply in numeric prefix order: extensions → tables → indexes → constraints → functions → triggers.

## CI auto-apply
The `schema-apply` CI job runs after every push to `main`. It checks whether any `database/schema/*.sql` file changed (via `git diff HEAD~1 HEAD`) and, if so, applies all modules in order to live RDS using IAM auth. No manual trigger or commit-message keyword needed — just edit a schema file and merge.

All schema files use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `CREATE OR REPLACE FUNCTION/VIEW`, so re-applying is idempotent.

## Apply to a fresh DB
```bash
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
./database/schema/_apply_all.sh
```
Or all at once:
```bash
cat database/schema/[0-9]*.sql | psql "$DATABASE_URL"
```

## Regenerate from live
```bash
pg_dump -h <RDS_HOST> -p 5432 -U app_user -d jeffi_stores \
  --schema-only --no-owner --no-acl \
  > database/schema-live.sql
```
Then split by domain into the numbered module files.

## Re-apply only one module
```bash
psql "$DATABASE_URL" -f database/schema/02_catalog.sql
```
