#!/bin/bash
# Step 3: point the four Secrets Manager secrets at jeffi_stores and give document-service a private bucket.
# Only the keys below change, a masked diff is shown first, and the previous versions stay restorable
# (rollback commands go to $OUT_DIR/secrets-rollback.sh). In-cluster URLs, DB_IAM_AUTH and PUBLIC_BASE_URL
# come from the manifests, not from here.
# Usage: bash deploy/k8s/db/30-secrets.sh [--dry-run] [--yes]
source "$(dirname "$0")/lib.sh"
mkdir -p "$OUT_DIR"
BUCKET=${DOCUMENTS_BUCKET:-jeffi-stores-documents}
DB_URL="postgresql://app_user@$RDS_HOST:5432/jeffi_stores"
TMP=$(mktemp -d); chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT
sm() { aws secretsmanager get-secret-value --secret-id "$1" --query "$2" --output text; }

# <secret id> <KEY=value ...>; =@prod copies the value from jeffi/production.
PATCHES=(
  "jeffi/production CONTROL_PLANE_RDS_DB=jeffi_stores"
  "jeffi/messaging/production CONTROL_PLANE_RDS_DB=jeffi_stores MESSAGING_DATABASE_URL=$DB_URL DATABASE_URL=$DB_URL SERVICE_AUTH_SECRET=@prod SHORT_LINK_SECRET=@prod"
  "jeffi/documents/production CONTROL_PLANE_RDS_DB=jeffi_stores DOCUMENTS_DATABASE_URL=$DB_URL DATABASE_URL=$DB_URL DOCUMENTS_BUCKET=$BUCKET SERVICE_AUTH_SECRET=@prod"
  "jeffi/public-api/production CONTROL_PLANE_RDS_DB=jeffi_stores CONTROL_PLANE_DATABASE_URL=$DB_URL DATABASE_URL=$DB_URL SERVICE_AUTH_SECRET=@prod"
)

cat > "$TMP/patch.py" <<'PY'
import json, sys
from urllib.parse import urlparse
cur_f, prod_f, out_f, *pairs = sys.argv[1:]
cur, prod = json.load(open(cur_f)), json.load(open(prod_f))
new = dict(cur)
def show(k, v):
    if v is None: return '(unset)'
    if 'SECRET' in k or 'PASSWORD' in k or 'TOKEN' in k: return '(hidden)'
    pw = urlparse(v).password if '://' in v else None
    return v.replace(pw, '***') if pw else v
changed = 0
for p in pairs:
    k, v = p.split('=', 1)
    if v == '@prod': v = prod[k]
    if cur.get(k) == v: continue
    new[k] = v; changed += 1
    print(f'  {k}: {show(k, cur.get(k))} -> {show(k, v)}')
json.dump(new, open(out_f, 'w'))
print(f'  {changed} change(s)' if changed else '  up to date')
sys.exit(0 if changed else 3)
PY

say "Documents bucket $BUCKET"
if err=$(aws s3api head-bucket --bucket "$BUCKET" 2>&1 >/dev/null); then BUCKET_STATE=exists
else case $err in *404*|*'Not Found'*) BUCKET_STATE=missing ;; *) echo "$err" >&2; echo "Pick another name: DOCUMENTS_BUCKET=<name>." >&2; exit 1 ;; esac; fi
echo "  $BUCKET_STATE"

say "Secret changes"
sm jeffi/production SecretString > "$TMP/prod.json"
CHANGED=""; i=0
for p in "${PATCHES[@]}"; do
  set -- $p; id=$1; shift; i=$((i + 1))
  if [ "$id" = jeffi/production ]; then cp "$TMP/prod.json" "$TMP/$i.cur"; else sm "$id" SecretString > "$TMP/$i.cur"; fi
  echo "$id"
  rc=0; python3 -I "$TMP/patch.py" "$TMP/$i.cur" "$TMP/prod.json" "$TMP/$i.new" "$@" || rc=$?
  if [ $rc = 0 ]; then CHANGED="$CHANGED $id|$i"; elif [ $rc != 3 ]; then exit 1; fi
done

if $DRY_RUN; then echo "Dry run: nothing written."; exit 0; fi
[ -n "$CHANGED" ] || [ "$BUCKET_STATE" = missing ] || { echo "Nothing to do."; exit 0; }
confirm "Create the bucket if missing and write the secret changes above?"

if [ "$BUCKET_STATE" = missing ]; then
  say "Create s3://$BUCKET (private, SSE-S3)"
  aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
fi

ROLLBACK=$OUT_DIR/secrets-rollback.sh
echo "# Restores the secret versions from before 30-secrets.sh ($STAMP)." > "$ROLLBACK"
for c in $CHANGED; do
  id=${c%|*}; n=${c#*|}
  old=$(sm "$id" VersionId)
  new=$(aws secretsmanager put-secret-value --secret-id "$id" --secret-string "file://$TMP/$n.new" --query VersionId --output text)
  echo "aws secretsmanager update-secret-version-stage --secret-id $id --version-stage AWSCURRENT --move-to-version-id $old --remove-from-version-id $new" >> "$ROLLBACK"
  echo "  $id updated"
done
echo "Done. Rollback: bash $ROLLBACK (pods read secrets at start, so restart them after either change)."
