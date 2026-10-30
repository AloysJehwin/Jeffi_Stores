#!/bin/bash
# Pods read Secrets Manager with their node's instance role: the core's (JeffiSecretsManagerRead) and, on a store's own
# servers, the tenant role's (jeffi-tenant-app). Each service loads its own secret (jeffi/<service>/production) and the
# store apps jeffi/store, so both policies list those too. Idempotent; keeps the rest.
# Usage: bash deploy/k8s/bootstrap/service-secrets-iam.sh [--dry-run]
set -euo pipefail
grant() {
  local ROLE=$1 POLICY=$2 DOC
  DOC=$(mktemp)
  aws iam get-role-policy --role-name "$ROLE" --policy-name "$POLICY" --query PolicyDocument --output json | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
st = d["Statement"] if isinstance(d["Statement"], list) else [d["Statement"]]
acts = lambda s: s["Action"] if isinstance(s["Action"], list) else [s["Action"]]
s = next(x for x in st if "secretsmanager:GetSecretValue" in acts(x))
r = s["Resource"] if isinstance(s["Resource"], list) else [s["Resource"]]
arn = "arn:aws:secretsmanager:us-east-1:708835965056:secret:jeffi/"
for a in [arn + n + "/production*" for n in ("messaging", "documents", "public-api", "mobile")] + [arn + "store-??????"]:
    if a not in r:
        r.append(a)
s["Resource"], d["Statement"] = r, st
json.dump(d, sys.stdout)
print("\n".join(r), file=sys.stderr)' > "$DOC"
  if [ "${DRY:-}" = 1 ]; then echo "(dry run) $ROLE/$POLICY would allow the secrets above"; return; fi
  aws iam put-role-policy --role-name "$ROLE" --policy-name "$POLICY" --policy-document "file://$DOC"
  echo "$ROLE can read the service secrets (IAM applies within seconds)."
}
[ "${1:-}" = --dry-run ] && DRY=1
grant jeffi-stores-ec2-role JeffiSecretsManagerRead
grant jeffi-tenant-app-role jeffi-tenant-app
