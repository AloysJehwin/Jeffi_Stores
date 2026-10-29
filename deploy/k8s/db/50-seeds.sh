#!/bin/bash
# After the rollout of every release: seed the platform's message-template catalog from inside the messaging
# pod (with its secrets), bring stored emails up to the catalog's content (platform defaults, and store copies
# nobody has edited), then move the stored WhatsApp bodies to the {{brand_name}} form (platform + every
# tenant DB; idempotent, what Meta sees is unchanged). Templates that already exist are skipped by the seed.
# --dry-run runs the same scripts read-only and prints what they would change.
# Usage: bash deploy/k8s/db/50-seeds.sh [--dry-run]
source "$(dirname "$0")/lib.sh"
k8s_tunnel
run() { # <script> [args]
  kubectl -n jeffi exec deploy/jeffi-stores-messaging-service -- env SPAWN_APP=1 \
    APP_ENTRY="messaging-service/scripts/$1" APP_CWD=messaging-service APP_NODE_ARGS='--import tsx' \
    APP_ARGS="${2:-}" node deploy/load-secrets.mjs
}
if $DRY_RUN; then APPLY=; SEED_ARGS=--dry-run; else APPLY=--apply; SEED_ARGS=; fi
say "Platform template catalog"
run seed-catalog.ts "$SEED_ARGS"
say "Email content -> current catalog"
run refresh-email-catalog.ts "$APPLY --tenant-dbs"
say "WhatsApp bodies -> {{brand_name}}"
run wa-brand-token.ts "$APPLY --tenant-dbs"
