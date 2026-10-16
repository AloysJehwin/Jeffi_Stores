#!/bin/bash
# Sets the Google Ads API settings for the controller, locally (.env.local.overrides, gitignored) and in
# production (jeffi/production in Secrets Manager; only these keys change, everything else is kept).
# Values come from flags or the environment, else a hidden prompt. Nothing is printed back.
#
#   bash deploy/k8s/bootstrap/google-ads-secrets.sh [--token T] [--mcc 1234567890] [--customer 1234567890]
#                                                  [--manager-refresh-token R] [--local-only | --prod-only]
# Env equivalents: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_CUSTOMER_ID,
# GOOGLE_ADS_MANAGER_REFRESH_TOKEN. Production pods pick the values up on their next rollout.
set -euo pipefail
cd "$(dirname "$0")/../../.."

TOKEN=${GOOGLE_ADS_DEVELOPER_TOKEN:-}; MCC=${GOOGLE_ADS_LOGIN_CUSTOMER_ID:-}; CID=${GOOGLE_ADS_CUSTOMER_ID:-}
REFRESH=${GOOGLE_ADS_MANAGER_REFRESH_TOKEN:-}; LOCAL=true; PROD=true; SECRET_ID=${SECRET_ID:-jeffi/production}
while [ $# -gt 0 ]; do
  case $1 in
    --token) TOKEN=$2; shift 2 ;;
    --mcc) MCC=$2; shift 2 ;;
    --customer) CID=$2; shift 2 ;;
    --manager-refresh-token) REFRESH=$2; shift 2 ;;
    --local-only) PROD=false; shift ;;
    --prod-only) LOCAL=false; shift ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
done

if [ -z "$TOKEN" ] && [ -t 0 ]; then read -rsp "Developer token: " TOKEN; echo; fi
[ -n "$TOKEN" ] || { echo "No developer token given (--token or GOOGLE_ADS_DEVELOPER_TOKEN)." >&2; exit 1; }
if [ -z "$MCC" ] && [ -t 0 ]; then read -rp "Manager (MCC) customer ID, Enter to skip: " MCC; fi
if [ -z "$CID" ] && [ -t 0 ]; then read -rp "Flagship Ads customer ID, Enter to skip: " CID; fi
MCC=${MCC//-/}; CID=${CID//-/}
for v in "$MCC" "$CID"; do
  if [ -n "$v" ] && ! [[ $v =~ ^[0-9]{10}$ ]]; then echo "Customer IDs are 10 digits (got '$v')." >&2; exit 1; fi
done

PAIRS=("GOOGLE_ADS_DEVELOPER_TOKEN=$TOKEN")
[ -n "$MCC" ] && PAIRS+=("GOOGLE_ADS_LOGIN_CUSTOMER_ID=$MCC")
[ -n "$CID" ] && PAIRS+=("GOOGLE_ADS_CUSTOMER_ID=$CID")
[ -n "$REFRESH" ] && PAIRS+=("GOOGLE_ADS_MANAGER_REFRESH_TOKEN=$REFRESH")
KEYS=$(printf '%s\n' "${PAIRS[@]}" | cut -d= -f1 | paste -sd, -)

if $LOCAL; then
  touch .env.local.overrides
  for kv in "${PAIRS[@]}"; do
    k=${kv%%=*}
    grep -v "^$k=" .env.local.overrides > .env.local.overrides.tmp || true
    mv .env.local.overrides.tmp .env.local.overrides
    printf '%s\n' "$kv" >> .env.local.overrides
  done
  echo "Local: set $KEYS in .env.local.overrides (restart the dev server to use them)"
fi

if $PROD; then
  CUR=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text)
  NEW=$(printf '%s' "$CUR" | PAIRS_JSON=$(printf '%s\n' "${PAIRS[@]}" | python3 -I -c 'import json,sys; print(json.dumps(dict(l.split("=",1) for l in sys.stdin.read().splitlines() if l)))') python3 -I -c '
import json, os, sys
cur = json.load(sys.stdin); upd = json.loads(os.environ["PAIRS_JSON"])
changed = [k for k, v in upd.items() if cur.get(k) != v]
cur.update(upd)
print(json.dumps({"changed": changed, "secret": cur}))')
  CHANGED=$(printf '%s' "$NEW" | python3 -I -c 'import json,sys; print(",".join(json.load(sys.stdin)["changed"]))')
  if [ -z "$CHANGED" ]; then
    echo "Production: $SECRET_ID already up to date"
  else
    aws secretsmanager put-secret-value --secret-id "$SECRET_ID" \
      --secret-string "$(printf '%s' "$NEW" | python3 -I -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["secret"]))')" > /dev/null
    echo "Production: set $CHANGED in $SECRET_ID (takes effect on the next rollout)"
  fi
fi
