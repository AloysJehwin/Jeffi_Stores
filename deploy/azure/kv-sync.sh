#!/bin/bash
# Copy every jeffi/* Secrets Manager secret into Key Vault under its dash name (jeffi/production -> jeffi-production,
# keyVaultName() in packages/store-core/src/lib/secrets/index.mjs; a test keeps kv_name equal to it). Dry run by default: lists each secret, its size and whether it
# would be created, updated or left alone. --apply writes. jeffi/local* and jeffi/*/local (developer secrets) are skipped unless
# --include-local. Values are never printed: each one goes from the AWS call into a 0600 file in a private temp
# dir, is compared by sha256 and uploaded with `az keyvault secret set --file`, and the dir is removed on exit.
# With asm-exec on PATH, values are resolved through it ({{resolve:secretsmanager:...}}) instead of the AWS CLI.
#
#   --patch <kv-secret> <KEY>   set one key of a JSON secret in the vault from stdin (read silently). Needs --apply.
#   --azure-db                  point the service secrets (AZ_DB_SECRETS) at the self-hosted Postgres pod: app_user's URL, its
#                               password from pg-app-password, in DATABASE_URL, CONTROL_PLANE_DATABASE_URL and any
#                               MESSAGING_/DOCUMENTS_DATABASE_URL, and the RDS IAM flags set to false. pg-init.sh runs
#                               it. Once pg-app-password exists the plain sync applies the same overrides, so copying
#                               from Secrets Manager again never brings the RDS values back. Needs --apply.
# Usage: bash deploy/azure/kv-sync.sh [--apply] [--include-local] [--only <sm-id>]
#        bash deploy/azure/kv-sync.sh --patch jeffi-production SOME_KEY [--apply]
#        bash deploy/azure/kv-sync.sh --azure-db [--apply]
set -euo pipefail
KV=${AZ_KEY_VAULT:-jeffi-prod-kv}
REGION=${AWS_REGION:-us-east-1}
AZ_PG_HOST=${AZ_PG_HOST:-flagship-postgres.jeffi.svc.cluster.local} # as deploy/k8s/db/lib.sh (in-cluster, so port 5432)
AZ_DB_SECRETS="jeffi-production jeffi-store jeffi-messaging-production jeffi-documents-production jeffi-public-api-production jeffi-mobile-production"
APPLY=false LOCAL=false ONLY='' PATCH=() AZDB=false
while [ $# -gt 0 ]; do case $1 in
  --apply) APPLY=true ;;
  --include-local) LOCAL=true ;;
  --only) ONLY=$2; shift ;;
  --patch) PATCH=("$2" "$3"); shift 2 ;;
  --azure-db) AZDB=true ;;
  *) echo "unknown argument $1" >&2; exit 2 ;;
esac; shift; done

umask 077
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
kv_name() { printf '%s' "$1" | tr -c 'A-Za-z0-9-' '-'; }
# A JSON string on stdin, written raw to <file> (exact bytes: the CLIs' text output adds a newline).
unjson() { python3 -I -c 'import json, sys; open(sys.argv[1], "w").write(json.load(sys.stdin) or "")' "$1"; }
sum() { [ -s "$1" ] && shasum -a 256 "$1" | cut -d' ' -f1 || echo none; }
# The vault's current value into <file> (empty when the secret doesn't exist).
kv_read() { az keyvault secret show --vault-name "$KV" --name "$1" --query value -o json 2>/dev/null | unjson "$2" 2>/dev/null || : > "$2"; }
kv_write() { az keyvault secret set --vault-name "$KV" --name "$1" --file "$2" --encoding utf-8 --output none; }

# app_user's in-cluster URL into $tmp/dburl, once pg-app-password exists (pg-init.sh); otherwise no file.
kv_read pg-app-password "$tmp/pgpw"
if [ -s "$tmp/pgpw" ]; then
  python3 -I -c 'import sys, urllib.parse
pw = open(sys.argv[1]).read().strip()
open(sys.argv[2], "w").write(f"postgresql://app_user:{urllib.parse.quote(pw, safe=str())}@{sys.argv[3]}:5432/jeffi_stores?sslmode=require")' "$tmp/pgpw" "$tmp/dburl" "$AZ_PG_HOST"
fi
rm -f "$tmp/pgpw"
is_db_secret() { case " $AZ_DB_SECRETS " in *" $1 "*) return 0 ;; esac; return 1; }
# <in> <out>: the JSON secret with the Azure DB overrides; the changed key names go to stderr, never values.
azure_db() {
  python3 -I -c 'import json, sys
d = json.load(open(sys.argv[1])); url = open(sys.argv[2]).read()
changed = []
def put(k, v):
    if d.get(k) != v:
        d[k] = v; changed.append(k)
for k in ("DATABASE_URL", "CONTROL_PLANE_DATABASE_URL"): put(k, url)
for k in ("MESSAGING_DATABASE_URL", "DOCUMENTS_DATABASE_URL"):
    if k in d: put(k, url)
for k in ("DB_IAM_AUTH", "RDS_IAM_AUTH", "CONTROL_PLANE_IAM_AUTH"):
    if k in d: put(k, "false")
json.dump(d, open(sys.argv[3], "w"))
print(",".join(changed) or "nothing", file=sys.stderr)' "$1" "$tmp/dburl" "$2"
}

if $AZDB; then
  [ -s "$tmp/dburl" ] || { echo "pg-app-password is not in $KV: run deploy/azure/pg-init.sh --apply first" >&2; exit 1; }
  echo "Azure DB overrides ($AZ_PG_HOST, app_user) in $KV:"
  for name in $AZ_DB_SECRETS; do
    kv_read "$name" "$tmp/cur"
    [ -s "$tmp/cur" ] || { echo "  $name: not in $KV, skipped"; continue; }
    keys=$(azure_db "$tmp/cur" "$tmp/new" 2>&1 >/dev/null)
    if [ "$keys" = nothing ]; then echo "  $name: already set"
    elif $APPLY; then kv_write "$name" "$tmp/new"; echo "  $name: written ($keys)"
    else echo "  $name: would set $keys"; fi
    rm -f "$tmp/cur" "$tmp/new"
  done
  $APPLY || echo "Dry run: nothing written (--apply)."
  exit 0
fi

if [ ${#PATCH[@]} -eq 2 ]; then
  name=${PATCH[0]} key=${PATCH[1]}
  kv_read "$name" "$tmp/cur"
  [ -s "$tmp/cur" ] || { echo "$name is not in $KV" >&2; exit 1; }
  read -r -s -p "Value for $key in $name (not echoed): " v; echo
  [ -n "$v" ] || { echo "Empty value: nothing changed." >&2; exit 1; }
  V="$v" K="$key" python3 -I -c 'import json, os, sys
d = json.load(open(sys.argv[1])); old = d.get(os.environ["K"])
d[os.environ["K"]] = os.environ["V"]; json.dump(d, open(sys.argv[2], "w"))
print("unchanged" if old == os.environ["V"] else ("updated" if old is not None else "added"), file=sys.stderr)' "$tmp/cur" "$tmp/new"
  unset v
  if $APPLY; then kv_write "$name" "$tmp/new"; echo "$name: $key written"; else echo "Dry run: $name not written (--apply)"; fi
  exit 0
fi

# Into <file>, never stdout.
sm_read() {
  if command -v asm-exec >/dev/null; then
    asm-exec -- sh -c 'printf %s "$1" > "$2"' _ "{{resolve:secretsmanager:$1}}" "$2"
  else
    aws secretsmanager get-secret-value --region "$REGION" --secret-id "$1" --query SecretString --output json | unjson "$2"
  fi
}

ids=$(aws secretsmanager list-secrets --region "$REGION" --filters Key=name,Values=jeffi/ --query 'SecretList[].Name' --output text | tr '\t' '\n' | sort)
[ -n "$ONLY" ] && ids=$(printf '%s\n' "$ids" | grep -Fx "$ONLY" || true)
printf '%-44s %-44s %8s  %s\n' "Secrets Manager" "Key Vault ($KV)" bytes action
n=0 bad=0
while read -r id; do
  [ -n "$id" ] || continue
  case $id in jeffi/local*|jeffi/*/local) $LOCAL || { printf '%-44s %-44s %8s  %s\n' "$id" - - "skipped (local)"; continue; } ;; esac
  name=$(kv_name "$id")
  [ ${#name} -le 127 ] || { echo "$id: Key Vault name too long" >&2; bad=1; continue; }
  if ! sm_read "$id" "$tmp/src" 2>"$tmp/err"; then echo "$id: read failed: $(head -c 200 "$tmp/err")" >&2; bad=1; continue; fi
  size=$(wc -c < "$tmp/src" | tr -d ' ')
  if [ "$size" -gt 25600 ]; then printf '%-44s %-44s %8s  %s\n' "$id" "$name" "$size" "TOO LARGE (Key Vault max 25 KB)"; bad=1; continue; fi
  note=''
  if [ -s "$tmp/dburl" ] && is_db_secret "$name"; then azure_db "$tmp/src" "$tmp/src.az" 2>/dev/null && mv "$tmp/src.az" "$tmp/src" && note=' (+ Azure DB)'; fi
  kv_read "$name" "$tmp/dst"
  if [ "$(sum "$tmp/src")" = "$(sum "$tmp/dst")" ]; then action=unchanged
  elif [ -s "$tmp/dst" ]; then action=update; else action=create; fi
  action=$action$note
  if $APPLY && [ "${action%% *}" != unchanged ]; then kv_write "$name" "$tmp/src" && action="$action: written"; fi
  printf '%-44s %-44s %8s  %s\n' "$id" "$name" "$size" "$action"
  n=$((n + 1))
  rm -f "$tmp/src" "$tmp/dst"
done <<<"$ids"
$APPLY || echo "Dry run: $n secret(s) compared, nothing written (--apply)."
exit $bad
