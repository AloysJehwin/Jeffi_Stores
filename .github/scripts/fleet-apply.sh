#!/usr/bin/env bash
# Bring one tenant-serving box up to date: nginx config, client-CA bundle, then the app image.
#
# Pool boxes have no deploy token, so they cannot pull the repo. The flagship publishes the two
# config files (and this script) to S3 during its own deploy; each box fetches them with its
# instance profile. That is also why this lives in S3 rather than being run from the checkout —
# the checkout on a pool box is whatever the AMI was built with.
set -euo pipefail

BASE="${FLEET_CONFIG_BASE:-s3://jeffi-stores-mtls-truststore/fleet}"
ROOT="${JEFFI_ROOT:-/opt/jeffi-stores}"
CONF="$ROOT/deploy/nginx-servers.conf"
BUNDLE="$ROOT/certs/client-ca-bundle.pem"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "── fetching fleet config ──"
aws s3 cp "$BASE/nginx-servers.conf"    "$TMP/nginx-servers.conf"    --only-show-errors
aws s3 cp "$BASE/client-ca-bundle.pem"  "$TMP/client-ca-bundle.pem"  --only-show-errors

# The bundle lives in a directory bind-mount, so a new file is visible to nginx immediately.
if ! cmp -s "$TMP/client-ca-bundle.pem" "$BUNDLE" 2>/dev/null; then
  install -m 0644 "$TMP/client-ca-bundle.pem" "$BUNDLE"
  echo "client-CA bundle updated ($(grep -c 'BEGIN CERTIFICATE' "$BUNDLE") CAs)"
  CHANGED=1
else
  echo "client-CA bundle unchanged"
fi

# nginx-servers.conf is bind-mounted as a single FILE, which Docker resolved once, by inode.
# Anything that REPLACES the file (aws s3 cp, install, mv, git checkout) leaves the container
# reading the old, now-unlinked inode — the change looks applied and silently is not. Writing
# through the existing inode with `cat >` keeps the mount valid and avoids a restart entirely.
if ! cmp -s "$TMP/nginx-servers.conf" "$CONF" 2>/dev/null; then
  cp "$CONF" "$TMP/nginx-servers.conf.bak"
  cat "$TMP/nginx-servers.conf" > "$CONF"
  echo "nginx config updated"
  CHANGED=1
else
  echo "nginx config unchanged"
fi

if [ "${CHANGED:-0}" = "1" ]; then
  # Validate through the running container, which is the thing that has to accept it. On
  # failure put the previous config back the same in-place way, so a bad publish cannot take
  # this box's tenants offline.
  if docker exec jeffi-nginx nginx -t; then
    docker exec jeffi-nginx nginx -s reload
    echo "nginx reloaded"
  else
    echo "nginx rejected the new config — restoring previous" >&2
    [ -f "$TMP/nginx-servers.conf.bak" ] && cat "$TMP/nginx-servers.conf.bak" > "$CONF"
    docker exec jeffi-nginx nginx -t && docker exec jeffi-nginx nginx -s reload || true
    exit 1
  fi
fi

# Config-only mode, for pushing an nginx or CA-bundle change without rolling the image —
# adding a tenant changes the bundle but not the code those boxes are running.
if [ "${FLEET_SKIP_APP:-0}" = "1" ]; then
  echo "FLEET_SKIP_APP=1 — config synced, leaving the app image alone"
  exit 0
fi

echo "── rolling the app image ──"
cd "$ROOT"
bash deploy/blue-green-deploy.sh
