#!/bin/bash
# Stores the npm publish token for @jeffi_erp/cli. Asks for it (hidden), checks it against the registry, then writes it
# to the Secrets Manager secret jeffi/npm (created if missing) and, with --github, to the repo secret NPM_TOKEN the
# cli-release workflow publishes with. jeffi/npm matches none of the patterns the pod and CI roles may read, and the
# token goes into no app secret (jeffi/production, jeffi/local, ...): nothing running needs it, only publishing does.
# Publish from a Mac: bash packages/cli/publish.sh. Prints no token.
# Usage: bash deploy/k8s/bootstrap/npm-token.sh [--github] [--dry-run] [--yes]
source "$(dirname "$0")/../db/lib.sh"
GITHUB=false
for a in "$@"; do case $a in
  --github) GITHUB=true ;; --dry-run|--yes) ;;
  *) echo "Unknown option $a" >&2; exit 2 ;;
esac; done
SECRET=jeffi/npm
umask 077
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

read -r -s -p "npm token for @jeffi_erp (input hidden): " TOKEN < /dev/tty; echo
TOKEN=$(printf %s "$TOKEN" | tr -d '[:space:]')
[ -n "$TOKEN" ] || { echo "No token given." >&2; exit 1; }

say "Checking the token with registry.npmjs.org"
# The header goes to curl over stdin, so the token never shows in the process list.
WHO=$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl -s -K - https://registry.npmjs.org/-/whoami |
  python3 -I -c 'import json, sys; print(json.load(sys.stdin).get("username", ""))' 2>/dev/null || true)
[ -n "$WHO" ] || { echo "npm did not accept the token (expired, revoked or mistyped)." >&2; exit 1; }
echo "  valid, belongs to npm user $WHO"
ORGS=$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl -s -K - "https://registry.npmjs.org/-/org/jeffi_erp/user" || true)
case $ORGS in *"\"$WHO\""*) echo "  $WHO is a member of the jeffi_erp org" ;;
  *) echo "  WARNING: could not confirm $WHO is in the jeffi_erp org; publishing will fail if the token can't write @jeffi_erp" ;;
esac

say "Secrets Manager $SECRET"
if aws secretsmanager describe-secret --secret-id "$SECRET" >/dev/null 2>&1; then
  aws secretsmanager get-secret-value --secret-id "$SECRET" --query SecretString --output text > "$TMP/cur.json"
  EXISTS=true
else
  echo '{}' > "$TMP/cur.json"
  EXISTS=false
fi
printf %s "$TOKEN" > "$TMP/token"
python3 -I - "$TMP/cur.json" "$TMP/token" "$TMP/new.json" <<'PY'
import json, sys
cur = json.load(open(sys.argv[1])); tok = open(sys.argv[2]).read()
print('  NPM_TOKEN: ' + ('unchanged' if cur.get('NPM_TOKEN') == tok else 'will be replaced' if cur.get('NPM_TOKEN') else 'will be set'))
json.dump({**cur, 'NPM_TOKEN': tok}, open(sys.argv[3], 'w'))
PY
$EXISTS || echo "  the secret does not exist yet; it will be created"
$GITHUB && { say "GitHub"; echo "  repo secret NPM_TOKEN will be set (gh secret set)"; }

if $DRY_RUN; then echo; echo "Dry run: nothing written."; exit 0; fi
echo; confirm "Write the token?"

if $EXISTS; then
  OLD=$(aws secretsmanager get-secret-value --secret-id "$SECRET" --query VersionId --output text)
  NEW=$(aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string "file://$TMP/new.json" --query VersionId --output text)
  mkdir -p "$OUT_DIR"
  echo "aws secretsmanager update-secret-version-stage --secret-id $SECRET --version-stage AWSCURRENT --move-to-version-id $OLD --remove-from-version-id $NEW" > "$OUT_DIR/npm-token-rollback.sh"
  echo "  $SECRET updated (rollback: bash $OUT_DIR/npm-token-rollback.sh)"
else
  aws secretsmanager create-secret --name "$SECRET" --description "npm publish token for @jeffi_erp/cli (deploy/k8s/bootstrap/npm-token.sh)" \
    --secret-string "file://$TMP/new.json" >/dev/null
  echo "  $SECRET created"
fi
if $GITHUB; then
  gh secret set NPM_TOKEN < "$TMP/token" >/dev/null
  echo "  GitHub NPM_TOKEN set"
fi
echo
echo "Done. A cli-v<version> tag publishes from GitHub; bash packages/cli/publish.sh publishes from this Mac."
