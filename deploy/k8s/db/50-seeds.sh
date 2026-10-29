#!/bin/bash
# After the release: seed the platform's message-template catalog from inside the messaging pod (with its
# secrets), bring stored emails up to the catalog's content (platform defaults, and store copies nobody
# has edited), then move the stored WhatsApp bodies to the {{brand_name}} form (platform + every tenant
# DB; idempotent, what Meta sees is unchanged). Templates that already exist are skipped by the seed.
# Usage: bash deploy/k8s/db/50-seeds.sh [--dry-run]
source "$(dirname "$0")/lib.sh"
k8s_tunnel
if $DRY_RUN; then echo "Dry run: would run messaging-service/scripts/seed-catalog.ts, refresh-email-catalog.ts --apply --tenant-dbs and wa-brand-token.ts --apply --tenant-dbs in jeffi-stores-messaging-service."; exit 0; fi
say "Platform template catalog"
kubectl -n jeffi exec deploy/jeffi-stores-messaging-service -- env SPAWN_APP=1 \
  APP_ENTRY=messaging-service/scripts/seed-catalog.ts APP_CWD=messaging-service APP_NODE_ARGS='--import tsx' \
  node deploy/load-secrets.mjs
say "Email content -> current catalog"
kubectl -n jeffi exec deploy/jeffi-stores-messaging-service -- env SPAWN_APP=1 \
  APP_ENTRY=messaging-service/scripts/refresh-email-catalog.ts APP_CWD=messaging-service APP_NODE_ARGS='--import tsx' \
  APP_ARGS='--apply --tenant-dbs' node deploy/load-secrets.mjs
say "WhatsApp bodies -> {{brand_name}}"
kubectl -n jeffi exec deploy/jeffi-stores-messaging-service -- env SPAWN_APP=1 \
  APP_ENTRY=messaging-service/scripts/wa-brand-token.ts APP_CWD=messaging-service APP_NODE_ARGS='--import tsx' \
  APP_ARGS='--apply --tenant-dbs' node deploy/load-secrets.mjs
