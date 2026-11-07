#!/bin/bash
# Publishes @jeffi_erp/cli from this Mac with the token in Secrets Manager jeffi/npm (deploy/k8s/bootstrap/npm-token.sh).
# The normal path is a cli-v<version> tag (GitHub, with provenance); this is for when GitHub is unavailable.
# Runs the same checks as the workflow first. A published version can't be reused.
# Usage: bash packages/cli/publish.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/../.."
DRY=false; [ "${1:-}" = --dry-run ] && DRY=true
VERSION=$(node -p "require('./packages/cli/package.json').version")
git diff --quiet HEAD -- packages/cli || { echo "packages/cli has uncommitted changes; commit them first." >&2; exit 1; }
if [ "$(curl -s -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/@jeffi_erp/cli/$VERSION")" = 200 ]; then
  echo "@jeffi_erp/cli@$VERSION is already published; bump packages/cli/package.json." >&2; exit 1
fi
npm run cli:check
npx vitest run --project cli
npm run cli:build
node packages/cli/dist/jeffi.js --version
umask 077
RC=$(mktemp); trap 'rm -f "$RC"' EXIT
# npm expands ${NPM_TOKEN} itself, so the token stays out of the file and argv.
echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > "$RC"
NPM_TOKEN=$(aws secretsmanager get-secret-value --secret-id jeffi/npm --query SecretString --output text |
  python3 -I -c 'import json, sys; print(json.load(sys.stdin)["NPM_TOKEN"])')
export NPM_TOKEN
cd packages/cli
if $DRY; then npm publish --dry-run --access public --userconfig "$RC"; exit 0; fi
read -r -p "Publish @jeffi_erp/cli@$VERSION to npm (public)? Type yes to continue: " a
[ "$a" = yes ] || { echo "Stopped."; exit 1; }
npm publish --access public --userconfig "$RC"
