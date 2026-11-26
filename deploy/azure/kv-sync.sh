#!/bin/bash
# Copy every jeffi/* Secrets Manager secret into Key Vault under its dash name (jeffi/production -> jeffi-production,
# keyVaultName() in packages/store-core/src/lib/secrets/index.mjs; a test keeps kv_name equal to it). Dry run by default: lists each secret, its size and whether it
# would be created, updated or left alone. --apply writes. jeffi/local* (developer secrets) is skipped unless
# --include-local. Values are never printed: each one goes from the AWS call into a 0600 file in a private temp
# dir, is compared by sha256 and uploaded with `az keyvault secret set --file`, and the dir is removed on exit.
# With asm-exec on PATH, values are resolved through it ({{resolve:secretsmanager:...}}) instead of the AWS CLI.
#
#   --patch <kv-secret> <KEY>   set one key of a JSON secret in the vault from stdin (read silently), e.g. the
#                               Azure DATABASE_URL in jeffi-production after pg-init.sh. Needs --apply to write.
# Usage: bash deploy/azure/kv-sync.sh [--apply] [--include-local] [--only <sm-id>]
#        bash deploy/azure/kv-sync.sh --patch jeffi-production DATABASE_URL [--apply]
set -euo pipefail
KV=${AZ_KEY_VAULT:-jeffi-prod-kv}
REGION=${AWS_REGION:-us-east-1}
APPLY=false LOCAL=false ONLY='' PATCH=()
while [ $# -gt 0 ]; do case $1 in
  --apply) APPLY=true ;;
  --include-local) LOCAL=true ;;
  --only) ONLY=$2; shift ;;
  --patch) PATCH=("$2" "$3"); shift 2 ;;
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
  case $id in jeffi/local*) $LOCAL || { printf '%-44s %-44s %8s  %s\n' "$id" - - "skipped (local)"; continue; } ;; esac
  name=$(kv_name "$id")
  [ ${#name} -le 127 ] || { echo "$id: Key Vault name too long" >&2; bad=1; continue; }
  if ! sm_read "$id" "$tmp/src" 2>"$tmp/err"; then echo "$id: read failed: $(head -c 200 "$tmp/err")" >&2; bad=1; continue; fi
  size=$(wc -c < "$tmp/src" | tr -d ' ')
  if [ "$size" -gt 25600 ]; then printf '%-44s %-44s %8s  %s\n' "$id" "$name" "$size" "TOO LARGE (Key Vault max 25 KB)"; bad=1; continue; fi
  kv_read "$name" "$tmp/dst"
  if [ "$(sum "$tmp/src")" = "$(sum "$tmp/dst")" ]; then action=unchanged
  elif [ -s "$tmp/dst" ]; then action=update; else action=create; fi
  if $APPLY && [ $action != unchanged ]; then kv_write "$name" "$tmp/src" && action="$action: written"; fi
  printf '%-44s %-44s %8s  %s\n' "$id" "$name" "$size" "$action"
  n=$((n + 1))
  rm -f "$tmp/src" "$tmp/dst"
done <<<"$ids"
$APPLY || echo "Dry run: $n secret(s) compared, nothing written (--apply)."
exit $bad
