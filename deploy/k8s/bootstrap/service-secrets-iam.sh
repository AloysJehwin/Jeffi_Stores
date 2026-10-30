#!/bin/bash
# Pods read Secrets Manager with the core's instance role, through its inline policy JeffiSecretsManagerRead. Each
# service loads its own secret (jeffi/<service>/production) and the store apps jeffi/store, so the policy lists those
# too. Idempotent; keeps the rest.
# Usage: bash deploy/k8s/bootstrap/service-secrets-iam.sh [--dry-run]
set -euo pipefail
ROLE=jeffi-stores-ec2-role POLICY=JeffiSecretsManagerRead
DOC=$(mktemp)
aws iam get-role-policy --role-name $ROLE --policy-name $POLICY --query PolicyDocument --output json | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
st = d["Statement"] if isinstance(d["Statement"], list) else [d["Statement"]]
acts = lambda s: s["Action"] if isinstance(s["Action"], list) else [s["Action"]]
s = next(x for x in st if "secretsmanager:GetSecretValue" in acts(x))
r = s["Resource"] if isinstance(s["Resource"], list) else [s["Resource"]]
for n in ("messaging/production", "documents/production", "public-api/production", "mobile/production", "store"):
    a = "arn:aws:secretsmanager:us-east-1:708835965056:secret:jeffi/%s-??????" % n if n == "store" else "arn:aws:secretsmanager:us-east-1:708835965056:secret:jeffi/%s*" % n
    if a not in r:
        r.append(a)
s["Resource"], d["Statement"] = r, st
json.dump(d, sys.stdout)
print("\n".join(r), file=sys.stderr)' > "$DOC"
if [ "${1:-}" = --dry-run ]; then echo "(dry run) $ROLE/$POLICY would allow the secrets above"; exit 0; fi
aws iam put-role-policy --role-name $ROLE --policy-name $POLICY --policy-document "file://$DOC"
echo "$ROLE can read the service secrets (IAM applies within seconds)."
