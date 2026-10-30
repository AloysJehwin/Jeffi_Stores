#!/bin/bash
# The store apps' secret (storefront, admin, business): jeffi/production without the keys only the control
# plane reads (store-secret-exclude.txt). Values go from one secret to the other without being printed.
# Re-run after changing jeffi/production. Usage: bash deploy/k8s/bootstrap/store-secret.sh [--dry-run]
set -euo pipefail
SRC=jeffi/production DST=jeffi/store REGION=us-east-1
HERE=$(cd "$(dirname "$0")" && pwd)
umask 077
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT
aws secretsmanager get-secret-value --region $REGION --secret-id $SRC --query SecretString --output text | python3 -I -c '
import json, sys
src = json.load(sys.stdin)
pats = [l.strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith("#")]
drop = lambda k: any(k.startswith(p[:-1]) if p.endswith("*") else k == p for p in pats)
json.dump({k: v for k, v in src.items() if not drop(k)}, open(sys.argv[2], "w"))
gone = sorted(k for k in src if drop(k))
print("%d keys kept, %d left out: %s" % (len(src) - len(gone), len(gone), " ".join(gone)), file=sys.stderr)' "$HERE/store-secret-exclude.txt" "$OUT"
if [ "${1:-}" = --dry-run ]; then echo "(dry run) $DST not written"; exit 0; fi
if aws secretsmanager describe-secret --region $REGION --secret-id $DST >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --region $REGION --secret-id $DST --secret-string "file://$OUT" >/dev/null
else
  aws secretsmanager create-secret --region $REGION --name $DST --description 'Store app pods: jeffi/production without control-plane keys (store-secret.sh)' --secret-string "file://$OUT" >/dev/null
fi
echo "$DST written."
