#!/bin/bash
# Pods read Secrets Manager with their node's instance role: the core's (JeffiSecretsManagerRead) and, on a store's own
# servers, the tenant role's (jeffi-tenant-app). Each service loads its own secret (jeffi/<service>/production) and the
# store apps jeffi/store, so both policies list those too. The core role also gets jeffi/tenant-db/* so the controller
# can create (CreateSecret + PutSecretValue), read (GetSecretValue) and delete/restore per-tenant Postgres passwords
# (on-node databases) and hand them to its pools; the tenant role must NOT get that. A store's own servers boot with
# the tenant role (instance profile jeffi-tenant-node-profile, created here) so the core role never lands on them; the
# tenant role reads jeffi/production/k3s to join the cluster. Then set K8S_TENANT_NODE_IAM_PROFILE (provisioning
# ConfigMap). Idempotent.
# Usage: bash deploy/k8s/bootstrap/service-secrets-iam.sh [--dry-run]
set -euo pipefail
grant() {
  local ROLE=$1 POLICY=$2 EXTRA=${3:-} DOC
  DOC=$(mktemp)
  EXTRA="$EXTRA" aws iam get-role-policy --role-name "$ROLE" --policy-name "$POLICY" --query PolicyDocument --output json | python3 -I -c '
import json, os, sys
d = json.load(sys.stdin)
st = d["Statement"] if isinstance(d["Statement"], list) else [d["Statement"]]
acts = lambda s: s["Action"] if isinstance(s["Action"], list) else [s["Action"]]
s = next(x for x in st if "secretsmanager:GetSecretValue" in acts(x))
r = s["Resource"] if isinstance(s["Resource"], list) else [s["Resource"]]
arn = "arn:aws:secretsmanager:us-east-1:708835965056:secret:jeffi/"
want = [arn + n + "/production*" for n in ("messaging", "documents", "public-api", "mobile")] + [arn + "store-??????"]
if os.environ.get("EXTRA") == "controller":
    want.append(arn + "tenant-db/*")
if os.environ.get("EXTRA") == "tenant":
    want.append(arn + "production/k3s-??????")
for a in want:
    if a not in r:
        r.append(a)
s["Resource"], d["Statement"] = r, st
# The controller must also CREATE and ROTATE per-tenant DB secrets, not just read them. Keep this in its
# own statement so the broad read statement stays read-only and the tenant role never inherits write.
if os.environ.get("EXTRA") == "controller":
    tdb = arn + "tenant-db/*"
    # Delete/Restore: a teardown schedules the secret for deletion (7-day recovery); a re-provision restores it.
    writeacts = ["secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:GetSecretValue",
                 "secretsmanager:DeleteSecret", "secretsmanager:RestoreSecret"]
    existing = None
    for x in st:
        if x.get("Sid") == "TenantDbSecretWrite":
            existing = x
            break
    if existing is None:
        st.append({"Sid": "TenantDbSecretWrite", "Effect": "Allow", "Action": writeacts, "Resource": tdb})
    else:
        ea = existing["Action"] if isinstance(existing["Action"], list) else [existing["Action"]]
        for act in writeacts:
            if act not in ea:
                ea.append(act)
        existing["Action"], existing["Resource"] = ea, tdb
    d["Statement"] = st
json.dump(d, sys.stdout)
print("\n".join(r), file=sys.stderr)' > "$DOC"
  if [ "${DRY:-}" = 1 ]; then echo "(dry run) $ROLE/$POLICY would allow the secrets above"; return; fi
  aws iam put-role-policy --role-name "$ROLE" --policy-name "$POLICY" --policy-document "file://$DOC"
  echo "$ROLE can read the service secrets (IAM applies within seconds)."
}
[ "${1:-}" = --dry-run ] && DRY=1
grant jeffi-stores-ec2-role JeffiSecretsManagerRead controller
grant jeffi-tenant-app-role jeffi-tenant-app tenant

PROFILE=jeffi-tenant-node-profile
if [ "${DRY:-}" = 1 ]; then echo "(dry run) instance profile $PROFILE would hold jeffi-tenant-app-role"; exit 0; fi
aws iam get-instance-profile --instance-profile-name $PROFILE >/dev/null 2>&1 ||
  aws iam create-instance-profile --instance-profile-name $PROFILE >/dev/null
aws iam get-instance-profile --instance-profile-name $PROFILE --query 'InstanceProfile.Roles[].RoleName' --output text | grep -qw jeffi-tenant-app-role ||
  aws iam add-role-to-instance-profile --instance-profile-name $PROFILE --role-name jeffi-tenant-app-role
echo "instance profile $PROFILE holds jeffi-tenant-app-role."
