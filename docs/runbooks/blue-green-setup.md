# Blue-Green Deployment — One-Time EC2 Setup

Run these commands **once** on the EC2 instance before the first blue-green pipeline deploy.
After this, all future deploys are fully automated via CI.

## Prerequisites

- SSH into the EC2 instance
- Working directory: `/opt/jeffi-stores`

---

## Steps

```bash
cd /opt/jeffi-stores

# 1. Pull latest code (includes new compose files and deploy scripts)
git fetch origin && git checkout main && git reset --hard origin/main

# 2. Create the shared external network (fixed name; both slots + infra attach to it)
docker network create jeffi_internal 2>/dev/null || echo "network already exists"

# 3. Bootstrap the active slot tracker
echo "blue" > active_slot

# 4. Copy initial upstream config (starts on blue)
cp deploy/nginx-blue.conf deploy/active-upstream.conf

# 5. Start the initial blue slot on the shared network
docker compose -f docker-compose.infra.yml -f docker-compose.blue.yml up -d --no-deps --force-recreate app_blue

# 6. Bring infra (nginx + redis) onto the shared network with the split config
docker compose -f docker-compose.infra.yml up -d --force-recreate nginx redis

# 7. Verify — nginx must resolve app_blue and serve 200
docker ps
docker exec jeffi-nginx nginx -t
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: jeffistores.in" http://localhost/api/health

# 8. Remove the OLD rolling-deploy app containers (only after step 7 shows 200)
docker compose -f docker-compose.prod.yml stop app 2>/dev/null || true
docker compose -f docker-compose.prod.yml rm -f app 2>/dev/null || true
```

> **Why the explicit network (step 2):** the blue/green compose files reference the network
> as `external` with the fixed name `jeffi_internal`. Without creating it first (or letting
> Compose's project-prefixed auto-name diverge), `docker compose ... app_<slot>` fails with
> *"network internal declared as external, but could not be found"*. All three compose files
> pin `name: jeffi_internal`, so nginx and both slots always share one network and DNS resolves.

After step 7 the site is live on the blue slot. The next CI deploy will switch to green,
then the one after that back to blue — alternating every deploy.

---

## Verify Active Slot Anytime

```bash
cat /opt/jeffi-stores/active_slot        # "blue" or "green"
docker ps --format "table {{.Names}}\t{{.Status}}"
```

---

## Manual Rollback (if needed)

Switch back to the previous slot instantly:

```bash
cd /opt/jeffi-stores
PREV=$([ "$(cat active_slot)" = "blue" ] && echo "green" || echo "blue")
cp deploy/nginx-${PREV}.conf deploy/active-upstream.conf
docker exec jeffi-nginx nginx -s reload
echo "$PREV" > active_slot
echo "Rolled back to: $PREV"
```

---

## Migration Dry Run (before first automated run)

Check which migrations are pending without applying anything:

```bash
cd /opt/jeffi-stores
export RDS_HOST=jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com
export RDS_PORT=5432
export RDS_USER=app_user
export RDS_DB=jeffi_stores
export AWS_REGION=us-east-1
bash deploy/run-migrations.sh --dry-run
```

Once you're happy with the list, apply for real:

```bash
bash deploy/run-migrations.sh
```

---

## Schema changes — two paths

The DB stays in sync with the repo through **two complementary mechanisms**. Know which to use:

### 1. Additive schema changes → edit the entity SQL, let schema-diff apply it

For **adding a column, table, or index**, just edit the entity file in `database/*.sql`
(e.g. add `gst_hsn_code text` to the `products` block in `database/catalog.sql`). On the
next deploy the pipeline runs `deploy/schema-diff.sh`, which:

1. Spins up a throwaway Postgres and loads all `database/*.sql` (the desired state)
2. Runs `migra` to diff desired vs live RDS
3. Applies **only additive statements** (`ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX IF NOT EXISTS`,
   `CREATE EXTENSION`, PK/UNIQUE constraints) — it never drops columns/tables automatically

Preview what it would apply without changing anything:

```bash
cd /opt/jeffi-stores
export RDS_HOST=jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com
export RDS_PORT=5432
export RDS_USER=app_user
export RDS_DB=jeffi_stores
export AWS_REGION=us-east-1
bash deploy/schema-diff.sh --dry-run
```

Drop the `--dry-run` to apply. Requires Docker (temp Postgres) + `migra` (auto-installed by the script).

### 2. Destructive / data changes → write a migration file

For anything schema-diff won't do — **dropping columns/tables, renaming, data backfills, or
one-off fixes** — add a timestamped file to `database/migrations/`:

```
database/migrations/YYYY-MM-DD_description.sql
```

`deploy/run-migrations.sh` applies each unapplied file in filename order and records it in the
`schema_migrations` table (so it never re-runs). Use `--dry-run` (above) to preview pending files.

> Keep the entity SQL (`database/*.sql`) in sync when you write a migration, so `schema-diff.sh`
> reports a clean diff afterward. Example: the admins `username`/`password_hash` removal shipped as
> `database/migrations/2026-08-05_admins_drop_username_password.sql` **and** edits to
> `database/users.sql` / `constraints.sql` / `functions.sql`.

| Change | Use |
|---|---|
| Add column / table / index | Edit `database/*.sql` → schema-diff applies it |
| Drop column/table, rename, backfill, data fix | New file in `database/migrations/` → run-migrations applies it |
