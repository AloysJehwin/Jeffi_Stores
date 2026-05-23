# Schema modules

Source of truth for the database schema, split by domain. Generated from a `pg_dump --schema-only` of the live RDS database on 2026-05-24.

## Apply order
Files apply in numeric prefix order: extensions → tables → indexes → constraints → functions → triggers.

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
ssh -i ~/.ssh/jeffi-stores-key.pem ec2-user@<EC2_IP> \
  "PGPASSWORD='...' pg_dump -h <RDS_HOST> -U postgres -d jeffi_stores --schema-only --no-owner --no-acl" \
  > database/schema-live.sql
```
Then re-run the modularizer.

## Re-apply only one module
```bash
psql "$DATABASE_URL" -f database/schema/02_catalog.sql
```

## Regenerate combined snapshot
```bash
cat database/schema/[0-9]*.sql > database/schema.sql
```
