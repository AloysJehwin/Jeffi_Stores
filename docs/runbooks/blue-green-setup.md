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

# 2. Bootstrap the active slot tracker
echo "blue" > active_slot

# 3. Copy initial upstream config (starts on blue)
cp deploy/nginx-blue.conf deploy/active-upstream.conf

# 4. Stop and remove the old docker-compose.prod.yml app containers
#    (nginx and redis stay up — they're now managed by docker-compose.infra.yml)
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml rm -f app

# 5. Recreate nginx with the new split config (active-upstream.conf + nginx-servers.conf)
docker compose -f docker-compose.infra.yml up -d --force-recreate nginx

# 6. Start the initial blue slot
docker compose -f docker-compose.infra.yml -f docker-compose.blue.yml up -d app_blue

# 7. Verify
docker ps
curl -s http://localhost:3000/api/health
```

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
