#!/bin/bash
# After the release: seed the platform's message-template catalog from inside the messaging pod (with its
# secrets). Templates that already exist are skipped. Usage: bash deploy/k8s/db/50-seeds.sh [--dry-run]
source "$(dirname "$0")/lib.sh"
k8s_tunnel
if $DRY_RUN; then echo "Dry run: would run messaging-service/scripts/seed-catalog.ts in jeffi-stores-messaging-service."; exit 0; fi
say "Platform template catalog"
kubectl -n jeffi exec deploy/jeffi-stores-messaging-service -- env SPAWN_APP=1 \
  APP_ENTRY=messaging-service/scripts/seed-catalog.ts APP_CWD=messaging-service APP_NODE_ARGS='--import tsx' \
  node deploy/load-secrets.mjs
