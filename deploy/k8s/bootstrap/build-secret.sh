#!/bin/bash
# The image build's secret: only jeffi/production's NEXT_PUBLIC_* keys (they ship in the browser bundle anyway), so
# the GitHub build role (github-oidc.sh) never reads jeffi/production. Prints key names, never values.
# Re-run after changing a NEXT_PUBLIC_* key in jeffi/production (scripts/set-secret.sh does it for you).
# Usage: bash deploy/k8s/bootstrap/build-secret.sh [--dry-run | --check]
#   --check  read-only; warns when it differs from jeffi/production (Deploy · AWS · prepare runs it on every release)
set -euo pipefail
SRC=jeffi/production DST=jeffi/production/build REGION=us-east-1
MODE=${1:-}
umask 077
OUT=$(mktemp) CUR=$(mktemp)
trap 'rm -f "$OUT" "$CUR"' EXIT
aws secretsmanager get-secret-value --region $REGION --secret-id $SRC --query SecretString --output text | python3 -I -c '
import json, sys
pub = {k: v for k, v in json.load(sys.stdin).items() if k.startswith("NEXT_PUBLIC_") and isinstance(v, str)}
json.dump(pub, open(sys.argv[1], "w"))
print("%d NEXT_PUBLIC_* keys: %s" % (len(pub), " ".join(sorted(pub))), file=sys.stderr)' "$OUT"
aws secretsmanager get-secret-value --region $REGION --secret-id $DST --query SecretString --output text > "$CUR" 2>/dev/null || : > "$CUR"
DIFF=$(python3 -I -c '
import json, sys
new = json.load(open(sys.argv[1]))
try: cur = json.load(open(sys.argv[2]))
except ValueError: print("missing"); sys.exit()
print(" ".join(sorted(k for k in set(new) | set(cur) if new.get(k) != cur.get(k))))' "$OUT" "$CUR")
[ -n "$DIFF" ] || { echo "$DST unchanged."; exit 0; }
[ "$DIFF" = missing ] && WHAT="missing (or unreadable)" || WHAT="differs in $DIFF"
case $MODE in
  --check) echo "::warning::$DST $WHAT: run bash deploy/k8s/bootstrap/build-secret.sh, then rebuild the images"; exit 0 ;;
  --dry-run) echo "(dry run) $DST not written: $WHAT"; exit 0 ;;
esac
if [ "$DIFF" = missing ]; then
  aws secretsmanager create-secret --region $REGION --name $DST --secret-string "file://$OUT" \
    --description 'Image build args: the NEXT_PUBLIC_* keys of jeffi/production (build-secret.sh)' >/dev/null
  echo "$DST created."
else
  aws secretsmanager put-secret-value --region $REGION --secret-id $DST --secret-string "file://$OUT" >/dev/null
  echo "$DST written ($WHAT)."
fi
