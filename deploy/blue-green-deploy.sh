#!/bin/bash
set -euo pipefail
cd /opt/jeffi-stores

ACTIVE=$(cat active_slot 2>/dev/null || echo "blue")
if [[ "$ACTIVE" == "blue" ]]; then IDLE="green"; else IDLE="blue"; fi

echo "Active=$ACTIVE  Idle=$IDLE"

# 1. Pull new image
docker pull ghcr.io/aloysjehwin/jeffi_stores:latest

# 2. Start idle slot (infra network must already exist via docker-compose.infra.yml)
docker compose -f docker-compose.infra.yml -f docker-compose.${IDLE}.yml up -d --no-deps --force-recreate app_${IDLE}

# 3. Health-check idle slot directly (30 attempts x 10s = 5 min max)
echo "Health-checking jeffi-app-${IDLE}..."
for i in $(seq 1 30); do
  HC=$(docker exec jeffi-app-${IDLE} wget -qO- http://localhost:3000/api/health 2>/dev/null && echo ok || echo fail)
  echo "  Attempt $i: $HC"
  if [[ "$HC" == "ok" ]]; then
    echo "Idle slot healthy."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "Idle slot failed health check after 5 minutes — aborting, keeping active slot."
    docker compose -f docker-compose.${IDLE}.yml stop app_${IDLE} 2>/dev/null || true
    docker compose -f docker-compose.${IDLE}.yml rm -f app_${IDLE} 2>/dev/null || true
    exit 1
  fi
  sleep 10
done

# 4. Switch nginx upstream to idle slot
cp deploy/nginx-${IDLE}.conf deploy/active-upstream.conf

# 5. Test nginx config then reload (zero downtime, <1s)
docker exec jeffi-nginx nginx -t
docker exec jeffi-nginx nginx -s reload
echo "nginx reloaded — traffic now on ${IDLE} slot."

# 6. Stop and remove old active slot
echo "Stopping ${ACTIVE} slot..."
docker compose -f docker-compose.${ACTIVE}.yml stop app_${ACTIVE} 2>/dev/null || true
docker compose -f docker-compose.${ACTIVE}.yml rm -f app_${ACTIVE} 2>/dev/null || true

# 7. Persist new active slot
echo "$IDLE" > active_slot

echo "Deploy complete. Active slot: $IDLE"
docker compose -f docker-compose.infra.yml -f docker-compose.${IDLE}.yml ps
