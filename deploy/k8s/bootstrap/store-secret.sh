#!/bin/bash
# The store apps' secret (storefront, admin, business): jeffi/production without the keys only the control
# plane reads (store-secret-exclude.txt). Values go from one secret to the other without being printed.
# Re-run after changing jeffi/production. JEFFI_CLOUD=azure (or --cloud=azure): the same in Key Vault, jeffi-production
# to jeffi-store, which the Azure controller copies into each store's namespace. --check compares only and warns when
# the store secret lags (the CI identity can read the vault, not write it).
# Usage: bash deploy/k8s/bootstrap/store-secret.sh [--dry-run|--check] [--cloud=aws|azure]
set -euo pipefail
CLOUD=${JEFFI_CLOUD:-aws} MODE=write
for a in "$@"; do case $a in
  --dry-run) MODE=dry ;; --check) MODE=check ;; --cloud=*) CLOUD=${a#--cloud=} ;;
  *) echo "unknown argument $a" >&2; exit 2 ;;
esac; done
case $CLOUD in
  aws) SRC=jeffi/production DST=jeffi/store ;;
  azure) SRC=jeffi-production DST=jeffi-store ;;
  *) echo "unknown cloud: $CLOUD" >&2; exit 2 ;;
esac
REGION=us-east-1 KV=${AZ_KEY_VAULT:-jeffi-prod-kv}
HERE=$(cd "$(dirname "$0")" && pwd)
umask 077
D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT
OUT=$D/out

read_secret() { # <name> <file>: the secret's JSON into <file>; fails when it does not exist
  if [ "$CLOUD" = azure ]; then
    az keyvault secret show --vault-name "$KV" --name "$1" --query value -o json |
      python3 -I -c 'import json, sys; open(sys.argv[1], "w").write(json.load(sys.stdin) or "")' "$2"
  else
    aws secretsmanager get-secret-value --region $REGION --secret-id "$1" --query SecretString --output text > "$2"
  fi
}
exists() {
  if [ "$CLOUD" = azure ]; then az keyvault secret show --vault-name "$KV" --name "$1" --query id -o tsv >/dev/null 2>&1
  else aws secretsmanager describe-secret --region $REGION --secret-id "$1" >/dev/null 2>&1; fi
}

read_secret "$SRC" "$D/src"
python3 -I -c '
import json, sys
src = json.load(open(sys.argv[3]))
pats = [l.strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith("#")]
drop = lambda k: any(k.startswith(p[:-1]) if p.endswith("*") else k == p for p in pats)
json.dump({k: v for k, v in src.items() if not drop(k)}, open(sys.argv[2], "w"))
gone = sorted(k for k in src if drop(k))
print("%d keys kept, %d left out: %s" % (len(src) - len(gone), len(gone), " ".join(gone)), file=sys.stderr)' "$HERE/store-secret-exclude.txt" "$OUT" "$D/src"
if [ "$MODE" = dry ]; then echo "(dry run) $DST not written"; exit 0; fi
if exists "$DST"; then
  read_secret "$DST" "$D/dst"
  if python3 -I -c 'import json, sys; sys.exit(json.load(open(sys.argv[1])) != json.load(open(sys.argv[2])))' "$D/dst" "$OUT"; then
    echo "$DST unchanged."
    exit 0
  fi
  if [ "$MODE" = check ]; then
    echo "${GITHUB_ACTIONS:+::warning::}$DST lags $SRC (keys or values differ); write it with: JEFFI_CLOUD=$CLOUD bash deploy/k8s/bootstrap/store-secret.sh"
    exit 0
  fi
  if [ "$CLOUD" = azure ]; then az keyvault secret set --vault-name "$KV" --name "$DST" --file "$OUT" --encoding utf-8 --output none
  else aws secretsmanager put-secret-value --region $REGION --secret-id $DST --secret-string "file://$OUT" >/dev/null; fi
else
  if [ "$MODE" = check ]; then
    echo "${GITHUB_ACTIONS:+::warning::}$DST does not exist (the controller falls back to $SRC, control-plane keys included); create it with: JEFFI_CLOUD=$CLOUD bash deploy/k8s/bootstrap/store-secret.sh"
    exit 0
  fi
  if [ "$CLOUD" = azure ]; then az keyvault secret set --vault-name "$KV" --name "$DST" --file "$OUT" --encoding utf-8 --output none
  else aws secretsmanager create-secret --region $REGION --name $DST --description 'Store app pods: jeffi/production without control-plane keys (store-secret.sh)' --secret-string "file://$OUT" >/dev/null; fi
fi
echo "$DST written."
